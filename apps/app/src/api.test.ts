import { describe, expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import { api } from "./api";
import collector from "../../collector/src/index";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

function mockDatabase(options: { listError?: Error; insertError?: Error } = {}): D1Database {
  return {
    prepare: vi.fn((_sql: string) => {
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn(async () => {
          if (options.listError) throw options.listError;
          return { results: [] };
        }),
        first: vi.fn(async () => null),
        run: vi.fn(async () => {
          if (options.insertError) throw options.insertError;
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

describe("source API database errors", () => {
  it("returns an internal error when listing sources fails", async () => {
    const db = mockDatabase({ listError: new Error("no such table: sources") });
    const response = await api.request("http://localhost/api/v1/sources", {}, { DB: db } as Env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("returns conflict only for the normalized URL unique constraint", async () => {
    const db = mockDatabase({
      insertError: new Error(
        "D1_ERROR: UNIQUE constraint failed: sources.normalized_url: SQLITE_CONSTRAINT",
      ),
    });
    const response = await api.request(
      "http://localhost/api/v1/sources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      },
      { DB: db } as Env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SOURCE_ALREADY_EXISTS" },
    });
  });

  it("preserves unrelated database failures as internal errors", async () => {
    const db = mockDatabase({ insertError: new Error("no such table: sources") });
    const response = await api.request(
      "http://localhost/api/v1/sources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      },
      { DB: db } as Env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});

function sourceCreationDatabase(options: { budgetAvailable?: boolean } = {}) {
  let sourceRow: Record<string, unknown> | null = null;
  const jobs: Array<{ id: string; status: string }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: vi.fn((...args: unknown[]) => {
          values = args;
          return statement;
        }),
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => {
          if (sql.startsWith("SELECT * FROM sources WHERE id = ?")) return sourceRow;
          if (sql.includes("RETURNING day_utc")) {
            return options.budgetAvailable === false ? null : { day_utc: "2026-10-25" };
          }
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.startsWith("INSERT INTO sources")) {
            const [id, url, folderId, title, titleIsCustom, siteUrl] = values;
            sourceRow = {
              id,
              folder_id: folderId,
              title,
              title_is_custom: titleIsCustom,
              site_url: siteUrl,
              normalized_url: url,
              status: "active",
              interval_minutes: 60,
              next_fetch_at: Math.floor(Date.now() / 1000),
              generation: 1,
              last_checked_at: null,
              last_success_at: null,
              last_error_code: null,
              consecutive_failures: 0,
            };
          }
          if (sql.startsWith("INSERT INTO fetch_jobs")) {
            jobs.push({ id: String(values[0]), status: "pending" });
          }
          if (sql.startsWith("UPDATE fetch_jobs SET status = 'sent'")) {
            const job = jobs.find((item) => item.id === values[1] && item.status === "pending");
            if (!job) return { success: true, meta: { changes: 0 } };
            job.status = "sent";
          }
          if (sql.startsWith("UPDATE fetch_jobs SET status = 'pending'")) {
            const job = jobs.find((item) => item.id === values[0] && item.status === "sent");
            if (job) job.status = "pending";
          }
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
  return { db, jobs };
}

describe("initial feed fetch scheduling", () => {
  it("sends an asynchronous fetch job when a feed is registered", async () => {
    const { db, jobs } = sourceCreationDatabase();
    const send = vi.fn(async (_message: QueueMessage) => ({
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
    }));
    const response = await api.request(
      "http://localhost/api/v1/sources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      },
      { DB: db, JOBS: { send } } as unknown as Env,
    );

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "fetch", jobId: jobs[0]?.id });
    expect(jobs).toEqual([{ id: jobs[0]?.id, status: "sent" }]);
  });

  it("keeps the registered feed when Queue delivery fails so the hourly tick can recover it", async () => {
    const { db, jobs } = sourceCreationDatabase();
    const send = vi.fn(async () => {
      throw new Error("Queue unavailable");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await api.request(
        "http://localhost/api/v1/sources",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ url: "https://example.com/feed.xml" }),
        },
        { DB: db, JOBS: { send } } as unknown as Env,
      );

      expect(response.status).toBe(201);
      expect(send).toHaveBeenCalledTimes(1);
      expect(jobs).toEqual([{ id: jobs[0]?.id, status: "pending" }]);
      expect(log).toHaveBeenCalledWith({ event: "initial_feed_fetch_enqueue_failed" });
    } finally {
      log.mockRestore();
    }
  });

  it("leaves the initial job pending when the daily Queue-operation budget is exhausted", async () => {
    const { db, jobs } = sourceCreationDatabase({ budgetAvailable: false });
    const send = vi.fn();
    const response = await api.request(
      "http://localhost/api/v1/sources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      },
      { DB: db, JOBS: { send } } as unknown as Env,
    );

    expect(response.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
    expect(jobs).toEqual([{ id: jobs[0]?.id, status: "pending" }]);
  });

  it.each(["same", "different"] as const)(
    "checks the source association when an active job belongs to the %s source",
    async (association) => {
      const database = sqliteD1();
      // Exercise the SQL guard itself rather than relying on the unique index to mask a missing guard.
      database.sqlite.exec("DROP INDEX fetch_jobs_one_active_per_source");
      if (association === "same") {
        database.sqlite.exec(`CREATE TRIGGER seed_initial_job AFTER INSERT ON sources BEGIN
          INSERT INTO fetch_jobs(id, source_id, generation, status)
          VALUES ('existing-job', NEW.id, NEW.generation, 'pending');
        END`);
      } else {
        database.sqlite
          .exec(`INSERT INTO sources(id, title, normalized_url) VALUES ('other-source', 'Other', 'https://example.com/other.xml');
          INSERT INTO fetch_jobs(id, source_id, generation, status) VALUES ('existing-job', 'other-source', 1, 'pending');`);
      }
      const send = vi.fn(async (_message: QueueMessage) => ({
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      }));
      try {
        const response = await api.request(
          "http://localhost/api/v1/sources",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: "http://localhost" },
            body: JSON.stringify({ url: "https://example.com/feed.xml" }),
          },
          { DB: database.binding, JOBS: { send } } as unknown as Env,
        );
        expect(response.status).toBe(201);
        const { data: created } = (await response.json()) as { data: { id: string } };
        const sourceJobs = database.sqlite
          .prepare("SELECT id, source_id, status FROM fetch_jobs WHERE source_id = ?")
          .all(created.id);
        if (association === "same") {
          expect(send).not.toHaveBeenCalled();
          expect(sourceJobs).toEqual([
            { id: "existing-job", source_id: created.id, status: "pending" },
          ]);
        } else {
          expect(send).toHaveBeenCalledTimes(1);
          expect(sourceJobs).toEqual([
            { id: expect.any(String), source_id: created.id, status: "sent" },
          ]);
          expect(send).toHaveBeenCalledWith({
            schemaVersion: 1,
            type: "fetch",
            jobId: sourceJobs[0]?.id,
          });
          expect(
            database.sqlite
              .prepare("SELECT source_id, status FROM fetch_jobs WHERE id = 'existing-job'")
              .get(),
          ).toEqual({ source_id: "other-source", status: "pending" });
        }
      } finally {
        database.sqlite.close();
      }
    },
  );

  it("enqueues the new source's initial fetch exactly once during OPML import", async () => {
    const database = sqliteD1();
    const send = vi.fn(async (_message: QueueMessage) => ({
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
    }));
    try {
      const response = await api.request(
        "http://localhost/api/v1/sources/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({
            sources: [{ url: "https://example.com/import.xml", title: "Imported feed" }],
          }),
        },
        { DB: database.binding, JOBS: { send } } as unknown as Env,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<{ status: string; source: { id: string; url: string } }>;
      };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.status).toBe("added");
      const job = database.sqlite.prepare("SELECT id, source_id, status FROM fetch_jobs").get();
      expect(job).toEqual({
        id: expect.any(String),
        source_id: body.data[0]?.source.id,
        status: "sent",
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "fetch", jobId: job?.id });
      expect(
        database.sqlite
          .prepare("SELECT normalized_url FROM sources WHERE id = ?")
          .get(job!.source_id),
      ).toEqual({ normalized_url: "https://example.com/import.xml" });
    } finally {
      database.sqlite.close();
    }
  });
});

describe("article reads", () => {
  it("returns stored articles without contacting external feeds", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Feed server unavailable"));
    const send = vi.fn();
    try {
      const response = await api.request("http://localhost/api/v1/articles", {}, {
        DB: mockDatabase(),
        JOBS: { send },
      } as unknown as Env);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [], nextCursor: null });
      expect(fetcher).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});

describe("initial fetch dispatch racing with the hourly tick", () => {
  async function runRace(cronWins: boolean) {
    const database = sqliteD1();
    const now = Date.parse("2026-10-25T01:00:08Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const messages: QueueMessage[] = [];
    let interleaved = false;
    const tick = async () => {
      database.state.queries = 0;
      await collector.queue(
        {
          queue: "test-jobs",
          messages: [
            {
              id: "tick",
              timestamp: new Date(now),
              attempts: 1,
              body: { schemaVersion: 1, type: "tick", scheduledAt: now - 8_000 },
              ack() {},
              retry() {},
            },
          ],
          ackAll() {},
          retryAll() {},
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        },
        env,
      );
    };
    const env = {
      DB: database.binding,
      JOBS: {
        send: vi.fn(async (message: QueueMessage) => {
          messages.push(message);
          if (!cronWins && message.type === "fetch" && !interleaved) {
            interleaved = true;
            await tick();
          }
          return { metadata: { metrics: { backlogCount: messages.length, backlogBytes: 0 } } };
        }),
        sendBatch: vi.fn(),
        metrics: vi.fn(),
      },
    };
    if (cronWins) {
      // Pause the App immediately before its claim; the tick sends the pending job first.
      const prepare = database.binding.prepare.bind(database.binding);
      database.binding.prepare = (sql: string) => {
        const statement = prepare(sql);
        if (!sql.startsWith("UPDATE fetch_jobs SET status = 'sent'")) return statement;
        const bind = statement.bind.bind(statement);
        statement.bind = (...values: unknown[]) => {
          const bound = bind(...values);
          const run = bound.run.bind(bound);
          bound.run = async () => {
            if (!interleaved) {
              interleaved = true;
              await tick();
            }
            return run();
          };
          return bound;
        };
        return statement;
      };
    }
    try {
      const response = await api.request(
        "http://localhost/api/v1/sources",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ url: "https://example.com/feed.xml" }),
        },
        env as unknown as Env,
      );
      expect(response.status).toBe(201);
      expect(messages.filter((message) => message.type === "fetch")).toHaveLength(1);
      expect(database.sqlite.prepare("SELECT status FROM fetch_jobs").all()).toEqual([
        { status: "sent" },
      ]);
      // Each fetch reserves four operations exactly once; ticks have their own reservations.
      expect(
        database.sqlite.prepare("SELECT reserved_queue_ops FROM daily_usage").get()
          ?.reserved_queue_ops,
      ).toBe(cronWins ? 12 : 8);
    } finally {
      database.sqlite.close();
      clock.mockRestore();
    }
  }

  it("does not dispatch or reserve twice when Cron claims the initial job first", async () => {
    await runRace(true);
  });

  it("does not dispatch or reserve twice when the App is already sending the initial job", async () => {
    await runRace(false);
  });
});

describe("source unread counts", () => {
  it("aggregates all sources in one query using the article list retention rules", async () => {
    const database = sqliteD1();
    const now = 1_800_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      database.sqlite.exec(`
        INSERT INTO sources(id, title, normalized_url, status, last_checked_at, last_success_at, next_fetch_at, last_error_code, consecutive_failures)
        VALUES ('active', 'Active', 'https://example.com/a', 'active', ${now - 60}, ${now - 3600}, ${now + 3600}, 'http_503', 2),
               ('paused', 'Paused', 'https://example.com/b', 'paused', NULL, NULL, ${now}, NULL, 0),
               ('archived', 'Archived', 'https://example.com/c', 'archived', NULL, NULL, ${now}, NULL, 0),
               ('empty', 'Empty', 'https://example.com/d', 'active', NULL, NULL, ${now}, NULL, 0);
        INSERT INTO boards(id, name) VALUES ('board', 'Saved');
      `);
      const fixtures = [
        ["fresh", "active", now + 1, null, 0, 0],
        ["expired", "active", now - 1, null, 0, 0],
        ["boundary", "active", now, null, 0, 0],
        ["starred", "active", now - 1, null, 1, 0],
        ["later", "active", now - 1, null, 0, 1],
        ["board-saved", "active", now - 1, null, 0, 0],
        ["multi-saved", "active", now - 1, null, 1, 1],
        ["already-read", "active", now + 1, now - 60, 1, 1],
        ["paused-article", "paused", now + 1, null, 0, 0],
        ["archived-article", "archived", now + 1, null, 0, 0],
      ] as const;
      for (const [id, source, expires, readAt, starred, later] of fixtures) {
        database.sqlite
          .prepare(
            "INSERT INTO item_keys(id, source_id, key_hash, first_seen_at) VALUES (?, ?, ?, ?)",
          )
          .run(id, source, id, now);
        database.sqlite
          .prepare(
            "INSERT INTO articles(id, title, url, first_seen_at, expires_at, read_at, starred, read_later) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, id, "https://example.com/" + id, now, expires, readAt, starred, later);
      }
      for (const id of ["board-saved", "multi-saved"])
        database.sqlite
          .prepare("INSERT INTO board_articles(board_id, article_id) VALUES ('board', ?)")
          .run(id);
      const response = await api.request("http://localhost/api/v1/sources", {}, {
        DB: database.binding,
      } as Env);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(database.state.queries).toBe(1);
      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "active",
            unreadCount: 5,
            lastCheckedAt: new Date((now - 60) * 1000).toISOString(),
            lastSuccessAt: new Date((now - 3600) * 1000).toISOString(),
            nextFetchAt: new Date((now + 3600) * 1000).toISOString(),
            errorCode: "http_503",
            consecutiveFailures: 2,
          }),
          expect.objectContaining({
            id: "paused",
            unreadCount: 1,
            lastCheckedAt: null,
            lastSuccessAt: null,
          }),
          expect.objectContaining({ id: "archived", unreadCount: 1 }),
          expect.objectContaining({ id: "empty", unreadCount: 0 }),
        ]),
      );
      const articles = await api.request(
        "http://localhost/api/v1/articles?scope=unread&sourceId=active",
        {},
        { DB: database.binding } as Env,
      );
      expect((await articles.json()).data).toHaveLength(5);
      await api.request(
        "http://localhost/api/v1/articles/read",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ articleIds: ["fresh"], read: true }),
        },
        { DB: database.binding } as Env,
      );
      const updated = await api.request("http://localhost/api/v1/sources", {}, {
        DB: database.binding,
      } as Env);
      expect(
        (await updated.json()).data.find((source: { id: string }) => source.id === "active")
          .unreadCount,
      ).toBe(4);
    } finally {
      vi.restoreAllMocks();
      database.sqlite.close();
    }
  });
});
