import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import worker from "./index";
import { sqliteD1 } from "./test/sqlite-d1";

const ROUND = Date.parse("2026-10-18T01:00:00Z");
const HOUR = 3_600_000;
let now = ROUND + 8_000;
let database: ReturnType<typeof sqliteD1>;
let queued: QueueMessage[];
let env: Env;

/** Generates bounded RSS documents with stable IDs and intentionally old publication dates. */
function feed(count: number, title = "Article", first = 0): string {
  return `<rss version="2.0"><channel><title>Feed</title>${Array.from({ length: count }, (_, i) =>
    `<item><guid>entry-${first + i}</guid><title>${title} ${first + i}</title><link>https://example.com/post/${first + i}</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>`,
  ).join("")}</channel></rss>`;
}

/** Seeds a subscription without consuming the per-invocation D1 query budget. */
function source(id: string, status = "active", nextFetch = 0): void {
  database.sqlite.prepare(
    "INSERT INTO sources(id, title, normalized_url, status, next_fetch_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, id, `https://example.com/${id}.xml`, status, nextFetch);
}

/** Delivers a Queue message through the real Worker handler. */
async function deliver(body: QueueMessage, attempts = 1): Promise<void> {
  database.state.queries = 0;
  await worker.queue({
    queue: "test-jobs", messages: [{
      id: crypto.randomUUID(), timestamp: new Date(now), body, attempts, ack() {}, retry() {},
    }], ackAll() {}, retryAll() {},
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  }, env);
}

/** Processes the in-memory queue, including continuation ticks. */
async function drain(): Promise<void> {
  let messages = 0;
  while (queued.length) {
    if (++messages > 500) throw new Error("Queue did not converge");
    await deliver(queued.shift()!);
  }
}

beforeEach(() => {
  now = ROUND + 8_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  database = sqliteD1();
  queued = [];
  env = {
    DB: database.binding,
    JOBS: {
      send: vi.fn(async (message: QueueMessage) => {
        queued.push(message);
        return { metadata: { metrics: { backlogCount: queued.length, backlogBytes: 0 } } };
      }),
      sendBatch: vi.fn(), metrics: vi.fn(),
    },
  };
});

afterEach(() => {
  database.sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hourly RSS collection", () => {
  it("only enqueues a tick from scheduled, without doing database or HTTP work", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await worker.scheduled({ scheduledTime: ROUND, cron: "0 * * * *", noRetry() {} }, env);
    expect(queued).toEqual([{ schemaVersion: 1, type: "tick", scheduledAt: ROUND }]);
    expect(database.state.queries).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("collects all 50 feeds once per round and again next hour without schedule drift", async () => {
    for (let i = 0; i < 50; i++) source(`source-${String(i).padStart(2, "0")}`);
    source("paused", "paused");
    source("archived", "archived");
    source("backoff", "active", ROUND / 1000 + 7_200);
    const fetcher = vi.fn(async () => new Response(feed(1)));
    vi.stubGlobal("fetch", fetcher);

    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    expect(fetcher).toHaveBeenCalledTimes(50);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(50);
    expect(database.sqlite.prepare("SELECT DISTINCT next_fetch_at FROM sources WHERE id LIKE 'source-%'").all())
      .toEqual([{ next_fetch_at: (ROUND + HOUR) / 1000 }]);

    // Duplicate ticks and fetch messages must not cause another poll in this round.
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    const job = database.sqlite.prepare("SELECT id FROM fetch_jobs LIMIT 1").get()!;
    await deliver({ schemaVersion: 1, type: "fetch", jobId: String(job.id) }, 2);
    expect(fetcher).toHaveBeenCalledTimes(50);

    now += HOUR;
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    await drain();
    expect(fetcher).toHaveBeenCalledTimes(100);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(50);
    expect(database.state.maximumQueries).toBeLessThanOrEqual(50);
  });

  it("handles 304 without parsing XML and sends conditional request headers", async () => {
    source("cached");
    database.sqlite.exec("UPDATE sources SET etag = 'old-etag', last_modified = 'Sun, 18 Oct 2026 00:00:00 GMT'");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetcher);
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("If-None-Match")).toBe("old-etag");
    expect(headers.get("If-Modified-Since")).toBe("Sun, 18 Oct 2026 00:00:00 GMT");
    expect(database.sqlite.prepare("SELECT last_error_code, next_fetch_at FROM sources").get())
      .toEqual({ last_error_code: null, next_fetch_at: (ROUND + HOUR) / 1000 });
    expect(database.sqlite.prepare("SELECT status FROM fetch_jobs").get()?.status).toBe("done");
  });

  it("adds new entries, updates changed content, and preserves reading state and expired tombstones", async () => {
    source("news");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(2))));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    database.sqlite.exec("UPDATE articles SET read_at = 123, starred = 1, read_later = 1, version = 7 WHERE url LIKE '%/0'");
    const saved = database.sqlite.prepare("SELECT * FROM articles WHERE url LIKE '%/0'").get();
    database.sqlite.exec("DELETE FROM articles WHERE url LIKE '%/1'");

    now += HOUR;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(3, "Edited"))));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    await drain();
    const updated = database.sqlite.prepare("SELECT * FROM articles WHERE url LIKE '%/0'").get()!;
    expect(updated).toEqual({ ...saved, title: "Edited 0", content_hash: expect.any(String), updated_at: now / 1000, version: 8 });
    expect(updated.content_hash).not.toBe(saved?.content_hash);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(2);
    expect(database.sqlite.prepare("SELECT title FROM articles WHERE url LIKE '%/2'").get()?.title).toBe("Edited 2");

    // HTTP 200 with identical content must not write any article records.
    database.state.beforeQuery = (sql) => {
      if (sql.includes("INSERT INTO articles") || sql.includes("UPDATE articles")) throw new Error("Unexpected article write");
    };
    now += HOUR;
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + 2 * HOUR });
    await drain();
  });

  it("stores a 200-entry feed within D1 query and bind limits", async () => {
    source("large");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(200))));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(200);
    expect(database.state.maximumQueries).toBeLessThanOrEqual(50);
    expect(database.state.maximumBinds).toBeLessThanOrEqual(100);

    // A mixed feed of 100 edits and 100 new entries must fit the same budget.
    now += HOUR;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(200, "Edited", 100))));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    await drain();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(300);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE version = 2").get()?.n).toBe(100);
    expect(database.state.maximumQueries).toBeLessThanOrEqual(50);
    expect(database.state.maximumBinds).toBeLessThanOrEqual(100);
  });

  it("retries partial content updates without advancing validators or updating completed entries twice", async () => {
    source("edited");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(25), { headers: { ETag: "old-etag" } })));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    now += HOUR;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(30, "Edited"), { headers: { ETag: "new-etag" } })));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    const job = queued.shift()!;
    let batches = 0;
    database.state.beforeQuery = (sql) => {
      if (sql.includes("INSERT INTO articles") && ++batches === 2) throw new Error("Simulated D1 outage");
    };
    await expect(deliver(job)).rejects.toThrow("Simulated D1 outage");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE version = 2").get()?.n).toBe(10);
    expect(database.sqlite.prepare("SELECT etag FROM sources").get()?.etag).toBe("old-etag");
    database.state.beforeQuery = () => {};
    now += 2_000;
    await deliver(job, 2);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(30);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE version = 2").get()?.n).toBe(25);
    expect(database.sqlite.prepare("SELECT etag FROM sources").get()?.etag).toBe("new-etag");
  });

  it("rolls back a failed chunk and resumes after partial save without advancing validators", async () => {
    source("partial");
    database.sqlite.exec("UPDATE sources SET etag = 'old-etag'");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(25), { headers: { ETag: "new-etag" } })));
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    const job = queued.shift()!;
    let batches = 0;
    database.state.beforeQuery = (sql) => {
      if (sql.includes("INSERT INTO articles") && ++batches === 2) throw new Error("Simulated D1 outage");
    };
    await expect(deliver(job)).rejects.toThrow("Simulated D1 outage");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(10);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM item_keys").get()?.n).toBe(10);
    expect(database.sqlite.prepare("SELECT etag FROM sources").get()?.etag).toBe("old-etag");
    database.state.beforeQuery = () => {};
    now += 2_000;
    await deliver(job, 2);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(25);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM item_keys").get()?.n).toBe(25);
    expect(database.sqlite.prepare("SELECT etag FROM sources").get()?.etag).toBe("new-etag");
  });

  it("recovers more than one page of pending, expired sent, and expired running jobs", async () => {
    for (let i = 0; i < 18; i++) {
      source(`recovered-${i}`);
      const status = ["pending", "sent", "running"][i % 3]!;
      database.sqlite.prepare(
        "INSERT INTO fetch_jobs(id, source_id, generation, status, lease_until, created_at) VALUES (?, ?, 1, ?, ?, ?)",
      ).run(`job-${i}`, `recovered-${i}`, status, i === 1 ? null : ROUND / 1000 - 1, ROUND / 1000 - 7_200);
    }
    source("live");
    database.sqlite.prepare(
      "INSERT INTO fetch_jobs(id, source_id, generation, status, lease_until) VALUES ('live-job', 'live', 1, 'sent', ?)",
    ).run(ROUND / 1000 + 3_600);
    const fetcher = vi.fn(async () => new Response(feed(1)));
    vi.stubGlobal("fetch", fetcher);
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    expect(fetcher).toHaveBeenCalledTimes(18);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM fetch_jobs WHERE status = 'done'").get()?.n).toBe(18);
    expect(database.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id = 'live-job'").get()?.status).toBe("sent");
  });

  it("repairs a Queue send failure at the next hourly tick", async () => {
    source("unsent");
    vi.mocked(env.JOBS.send).mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND })).rejects.toThrow("Queue unavailable");
    expect(database.sqlite.prepare("SELECT status FROM fetch_jobs").get()?.status).toBe("pending");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(feed(1))));
    now += HOUR;
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    await drain();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get()?.n).toBe(1);
  });

  it("honors Retry-After and ignores old round messages", async () => {
    source("limited");
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "7200" } }));
    vi.stubGlobal("fetch", fetcher);
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await drain();
    expect(database.sqlite.prepare("SELECT last_error_code FROM sources").get()?.last_error_code).toBe("http_429");
    now += HOUR;
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + HOUR });
    await drain();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops dispatch at the daily operation budget and resumes on the next UTC day", async () => {
    source("budget");
    database.sqlite.exec("INSERT INTO daily_usage(day_utc, reserved_queue_ops) VALUES ('2026-10-18', 7996)");
    const fetcher = vi.fn(async () => new Response(feed(1)));
    vi.stubGlobal("fetch", fetcher);
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND });
    expect(queued).toHaveLength(0);
    expect(database.sqlite.prepare("SELECT reserved_queue_ops FROM daily_usage").get()?.reserved_queue_ops).toBe(8000);
    now += 24 * HOUR;
    await deliver({ schemaVersion: 1, type: "tick", scheduledAt: ROUND + 24 * HOUR });
    await drain();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
