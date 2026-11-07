import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import { writeD1UsageConfig, writeD1UsageSnapshot } from "@tayori/shared/d1-usage";
import worker from "./index";
import { sqliteD1 } from "./test/sqlite-d1";

const now = Date.parse("2026-10-18T01:00:00Z");
const limits = {
  storageBytes: 100,
  rowsRead: 100,
  rowsWritten: 100,
  warningRatio: 0.8,
  maxAgeSeconds: 3600,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("usage control integration", () => {
  it("stops dispatch and HTTP, keeps saved articles, purges expired articles, then resumes with a fresh observation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = sqliteD1();
    const send = vi.fn(async (_message: QueueMessage) => ({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('<rss version="2.0"><channel><title>Feed</title></channel></rss>'),
      );
    vi.stubGlobal("fetch", fetcher);
    const env = {
      DB: db.binding,
      JOBS: { send, sendBatch: vi.fn(), metrics: vi.fn() },
    } as unknown as Env;
    const snapshot = {
      observedAt: new Date(now).toISOString(),
      dayUtc: "2026-10-18",
      storageBytes: 100,
      rowsRead: 1,
      rowsWritten: 1,
    };
    await writeD1UsageConfig(db.binding, { enabled: true, limits });
    await writeD1UsageSnapshot(db.binding, snapshot);
    db.sqlite
      .exec(`INSERT INTO sources(id,title,normalized_url,status,next_fetch_at) VALUES ('existing','Existing','https://example.com/feed','active',0), ('due','Due','https://example.com/due','active',0);
      INSERT INTO fetch_jobs(id,source_id,generation,status,created_at) VALUES ('job','existing',1,'pending',${now / 1000});
      INSERT INTO item_keys(id,source_id,key_hash,first_seen_at) VALUES ('expired','existing','expired',1), ('saved','existing','saved',1);
      INSERT INTO articles(id,title,url,first_seen_at,expires_at,starred) VALUES ('expired','Expired','https://example.com/a',1,2,0), ('saved','Saved','https://example.com/b',1,2,1);`);
    async function deliver(body: QueueMessage) {
      db.state.queries = 0;
      await worker.queue(
        {
          queue: "test",
          messages: [
            { id: "m", timestamp: new Date(now), body, attempts: 1, ack() {}, retry() {} },
          ],
          ackAll() {},
          retryAll() {},
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        },
        env,
      );
    }
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: now });
    await deliver({ schemaVersion: 1, type: "fetch", jobId: "job" });
    expect(send).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT id FROM articles").all()).toEqual([{ id: "saved" }]);
    expect(db.sqlite.prepare("SELECT id,status FROM fetch_jobs").all()).toEqual([
      { id: "job", status: "pending" },
    ]);
    db.state.queries = 0;
    await writeD1UsageSnapshot(db.binding, { ...snapshot, storageBytes: 1 });
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: now });
    expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "fetch", jobId: "job" });
    await deliver({ schemaVersion: 1, type: "fetch", jobId: "job" });
    expect(fetcher).toHaveBeenCalled();
    db.sqlite.close();
  });

  it("enqueues a tick even when usage and monitoring requests fail", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const db = sqliteD1();
    db.sqlite.exec(
      "INSERT INTO sources(id,title,normalized_url,consecutive_failures) VALUES ('source','Source','https://example.com',3)",
    );
    const send = vi.fn(async () => ({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    }));
    const env = {
      DB: db.binding,
      JOBS: { send },
      D1_USAGE_ENABLED: "true",
      D1_ANALYTICS_TOKEN: "token",
      D1_ACCOUNT_ID: "account",
      D1_DATABASE_ID: "db",
      D1_STORAGE_LIMIT_BYTES: "100",
      D1_ROWS_READ_LIMIT: "100",
      D1_ROWS_WRITTEN_LIMIT: "100",
      D1_WARNING_RATIO: "0.8",
      D1_MAX_AGE_SECONDS: "3600",
      MONITOR_WEBHOOK_URL: "https://example.com/hook",
    } as unknown as Env;
    await worker.scheduled({ scheduledTime: now, cron: "0 * * * *", noRetry() {} }, env);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "tick", scheduledAt: now });
    db.sqlite.close();
  });
});
