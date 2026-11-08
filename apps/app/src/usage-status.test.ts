import { expect, it, vi } from "vitest";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

it("reports aggregate collection status without D1 usage polling", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T01:00:00Z"));
  const db = sqliteD1();
  try {
    db.sqlite
      .exec(`INSERT INTO sources(id,title,normalized_url,status,last_success_at,consecutive_failures) VALUES ('private','Private','https://private.test','active',1792285140,2);
      INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('job','private',1,'pending',1792285100);
      INSERT INTO daily_usage(day_utc,reserved_queue_ops) VALUES ('2026-10-18',7997);`);
    const env = { DB: db.binding } as Env;
    const response = await api.request("http://localhost/api/v1/status", {}, env);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      data: {
        lastSuccessAt: new Date(1792285140 * 1000).toISOString(),
        oldestPendingAt: new Date(1792285100 * 1000).toISOString(),
        maxConsecutiveFailures: 2,
        queueBudgetStopped: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("private");
    expect((body as { data: object }).data).not.toHaveProperty("d1Usage");
    vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
    db.state.queries = 0;
    const nextDay = await api.request("http://localhost/api/v1/status", {}, env);
    expect(nextDay.status).toBe(200);
    expect(await nextDay.json()).toMatchObject({ data: { queueBudgetStopped: false } });
  } finally {
    db.sqlite.close();
    vi.useRealTimers();
  }
});
