import { expect, it } from "vitest";
import { sqliteD1 } from "./test/sqlite-d1";
import { readMonitoringSnapshot } from "./monitoring";

it("reads aggregate health without writes or private feed data", async () => {
  const { binding, sqlite, state } = sqliteD1();
  sqlite.exec(`INSERT INTO sources(id,normalized_url,title,consecutive_failures,last_success_at) VALUES ('private-id','https://private.test','private-title',3,42);
    INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('private-job','private-id',1,'pending',10);
    INSERT INTO daily_usage(day_utc,reserved_queue_ops) VALUES ('1970-01-01',7997);`);
  const snapshot = await readMonitoringSnapshot(binding, 100);
  expect(snapshot).toMatchObject({
    lastTick: null,
    lastSuccess: 42,
    failingSources: 1,
    maxConsecutiveFailures: 3,
    pendingJobs: 1,
    oldestPendingAgeSeconds: 90,
    queueBudgetStopped: true,
  });
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(sqlite.prepare("SELECT * FROM app_state").all()).toEqual([]);
  expect(state.maximumQueries).toBeLessThanOrEqual(50);
  expect(state.maximumBinds).toBeLessThanOrEqual(100);
  sqlite.close();
});

it("keeps absent success and backlog times as null and rolls over daily budget", async () => {
  const { binding, sqlite } = sqliteD1();
  sqlite.exec("INSERT INTO daily_usage(day_utc,reserved_queue_ops) VALUES ('1970-01-01',7997)");
  expect(await readMonitoringSnapshot(binding, 86400)).toMatchObject({
    lastTick: null,
    lastSuccess: null,
    pendingJobs: 0,
    oldestPendingAgeSeconds: null,
    queueBudgetStopped: false,
  });
  sqlite.close();
});
