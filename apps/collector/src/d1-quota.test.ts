import { expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import worker from "./index";
import { sqliteD1 } from "./test/sqlite-d1";

it("rethrows quota failures without recording a feed failure and repairs the job on a later tick", async () => {
  let now = Date.parse("2026-11-08T12:00:00Z");
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = sqliteD1();
  db.sqlite
    .exec(`INSERT INTO sources(id,title,normalized_url,status,next_fetch_at) VALUES ('s','S','https://example.com/feed','active',0);
    INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('j','s',1,'pending',${now / 1000});`);
  const send = vi.fn(async (_message: QueueMessage) => ({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  }));
  const env = { DB: db.binding, JOBS: { send } } as unknown as Env;
  const deliver = async (body: QueueMessage) => {
    db.state.queries = 0;
    await worker.queue(
      {
        queue: "test",
        messages: [{ id: "m", timestamp: new Date(now), body, attempts: 1, ack() {}, retry() {} }],
        ackAll() {},
        retryAll() {},
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      },
      env,
    );
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 304 })),
  );
  db.state.beforeQuery = (sql) => {
    if (sql.includes("UPDATE sources SET last_checked_at"))
      throw new Error("D1_ERROR: free tier daily row write limit: private");
  };
  await expect(deliver({ schemaVersion: 1, type: "fetch", jobId: "j" })).rejects.toThrow();
  expect(log).toHaveBeenCalledWith({ event: "d1_quota_exceeded", code: "D1_DAILY_WRITE_LIMIT" });
  expect(db.sqlite.prepare("SELECT consecutive_failures FROM sources WHERE id='s'").get()).toEqual({
    consecutive_failures: 0,
  });
  expect(db.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id='j'").get()).toEqual({
    status: "running",
  });
  db.state.beforeQuery = () => {};
  now += 3_600_000;
  await deliver({ schemaVersion: 1, type: "tick", scheduledAt: now });
  expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "fetch", jobId: "j" });
  db.sqlite.close();
  clock.mockRestore();
  log.mockRestore();
  vi.unstubAllGlobals();
});
