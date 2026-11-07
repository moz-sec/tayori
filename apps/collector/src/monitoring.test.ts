import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "./test/sqlite-d1";
import { readMonitoringSnapshot, runMonitoring } from "./monitoring";

describe("monitoring", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("notifies on onset and recovery, suppressing repeats and private data", async () => {
    const { binding, sqlite, state } = sqliteD1();
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const options = { webhookUrl: "https://example.test/secret", tickStaleSeconds: 10 };
    await runMonitoring(binding, 100, options);
    state.queries = 0;
    await runMonitoring(binding, 110, options);
    state.queries = 0;
    await runMonitoring(binding, 120, options);
    expect(send).toHaveBeenCalledTimes(1);
    sqlite.prepare("INSERT INTO app_state(key,value) VALUES ('last_tick','120')").run();
    state.queries = 0;
    await runMonitoring(binding, 121, options);
    expect(send).toHaveBeenCalledTimes(2);
    const bodies = send.mock.calls.map((call) => String(call[1].body));
    expect(bodies[0]).toContain("tick_stale started");
    expect(bodies[1]).toContain("tick_stale recovered");
    expect(bodies.join()).not.toContain("secret");
  });
  it("reports aggregate failure, backlog and budget and retries a failed notification", async () => {
    const { binding, sqlite, state } = sqliteD1();
    sqlite
      .prepare(
        "INSERT INTO sources(id, normalized_url, title, consecutive_failures, last_success_at) VALUES ('id','https://private.test','private',3,42)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('job','id',1,'pending',10)",
      )
      .run();
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const opts = {
      webhookUrl: "https://example.test/hook",
      backlogStaleSeconds: 10,
      budgetStopped: true,
    };
    expect(await readMonitoringSnapshot(binding, 3, true)).toMatchObject({
      lastSuccess: 42,
      failingSources: 1,
      oldestPending: 10,
      budgetStopped: true,
    });
    await expect(runMonitoring(binding, 100, opts)).rejects.toThrow(
      "Monitoring notification failed",
    );
    state.queries = 0;
    await runMonitoring(binding, 100, opts);
    expect(send).toHaveBeenCalledTimes(2);
    const body = String(send.mock.calls[1]![1].body);
    expect(body).toContain("feed_failures");
    expect(body).toContain("queue_stale");
    expect(body).toContain("budget_stopped");
    expect(body).not.toContain("private");
  });
  it("honors thresholds, partial recovery, daily idle and queue budget rollover", async () => {
    const { binding, sqlite, state } = sqliteD1();
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const opts = {
      webhookUrl: "https://example.test/hook",
      tickStaleSeconds: 100,
      backlogStaleSeconds: 20,
      failureThreshold: 3,
    };
    sqlite.prepare("INSERT INTO app_state(key,value) VALUES ('last_tick','100')").run();
    sqlite
      .prepare(
        "INSERT INTO sources(id,normalized_url,title,consecutive_failures,next_fetch_at) VALUES ('a','https://private.test','private',2,86400)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('job','a',1,'sent',100)",
      )
      .run();
    await runMonitoring(binding, 119, opts);
    expect(send).not.toHaveBeenCalled();
    state.queries = 0;
    sqlite.prepare("UPDATE sources SET consecutive_failures=3").run();
    await runMonitoring(binding, 120, opts);
    expect(String(send.mock.calls[0]![1].body)).toContain("queue_stale started");
    expect(String(send.mock.calls[0]![1].body)).toContain("feed_failures started");
    sqlite.prepare("UPDATE sources SET consecutive_failures=0").run();
    state.queries = 0;
    await runMonitoring(binding, 121, opts);
    const partial = String(send.mock.calls[1]![1].body);
    expect(partial).toContain("feed_failures recovered");
    expect(partial).not.toContain("queue_stale recovered");
    sqlite
      .prepare("INSERT INTO daily_usage(day_utc,reserved_queue_ops) VALUES ('1970-01-01',7997)")
      .run();
    state.queries = 0;
    expect((await readMonitoringSnapshot(binding, 3, false, 121)).queueBudgetStopped).toBe(true);
    state.queries = 0;
    expect((await readMonitoringSnapshot(binding, 3, false, 86400)).queueBudgetStopped).toBe(false);
  });
});
