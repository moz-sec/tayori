import { describe, expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import { api } from "./api";

function mockDatabase(options: { listError?: Error; insertError?: Error } = {}): D1Database {
  return {
    prepare: vi.fn((sql: string) => {
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
      insertError: new Error("D1_ERROR: UNIQUE constraint failed: sources.normalized_url: SQLITE_CONSTRAINT"),
    });
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db } as Env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SOURCE_ALREADY_EXISTS" } });
  });

  it("preserves unrelated database failures as internal errors", async () => {
    const db = mockDatabase({ insertError: new Error("no such table: sources") });
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db } as Env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});

function sourceCreationDatabase(options: { budgetAvailable?: boolean; activeFetchJob?: boolean } = {}) {
  let sourceRow: Record<string, unknown> | null = null;
  const jobs: Array<{ id: string; status: string }> = options.activeFetchJob
    ? [{ id: "existing-job", status: "pending" }]
    : [];
  const db = {
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: vi.fn((...args: unknown[]) => { values = args; return statement; }),
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
              id, folder_id: folderId, title, title_is_custom: titleIsCustom, site_url: siteUrl,
              normalized_url: url, status: "active", interval_minutes: 60,
              next_fetch_at: Math.floor(Date.now() / 1000), generation: 1,
              last_checked_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0,
            };
          }
          if (sql.startsWith("INSERT INTO fetch_jobs")) {
            if (options.activeFetchJob) return { success: true, meta: { changes: 0 } };
            jobs.push({ id: String(values[0]), status: "pending" });
          }
          if (sql.startsWith("UPDATE fetch_jobs SET status = 'sent'")) {
            const job = jobs.find((item) => item.id === values[1]);
            if (job) job.status = "sent";
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
    const send = vi.fn(async (_message: QueueMessage) => ({ metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } } }));
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db, JOBS: { send } } as unknown as Env);

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({ schemaVersion: 1, type: "fetch", jobId: jobs[0]?.id });
    expect(jobs).toEqual([{ id: jobs[0]?.id, status: "sent" }]);
  });

  it("keeps the registered feed when Queue delivery fails so the hourly tick can recover it", async () => {
    const { db, jobs } = sourceCreationDatabase();
    const send = vi.fn(async () => { throw new Error("Queue unavailable"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await api.request("http://localhost/api/v1/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      }, { DB: db, JOBS: { send } } as unknown as Env);

      expect(response.status).toBe(201);
      expect(send).toHaveBeenCalledTimes(1);
      expect(jobs).toEqual([{ id: jobs[0]?.id, status: "pending" }]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("initial_feed_fetch_enqueue_failed"));
    } finally {
      log.mockRestore();
    }
  });

  it("leaves the initial job pending when the daily Queue-operation budget is exhausted", async () => {
    const { db, jobs } = sourceCreationDatabase({ budgetAvailable: false });
    const send = vi.fn();
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db, JOBS: { send } } as unknown as Env);

    expect(response.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
    expect(jobs).toEqual([{ id: jobs[0]?.id, status: "pending" }]);
  });

  it("does not send a second initial job when the source already has an active job", async () => {
    const { db, jobs } = sourceCreationDatabase({ activeFetchJob: true });
    const send = vi.fn();
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db, JOBS: { send } } as unknown as Env);

    expect(response.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
    expect(jobs).toEqual([{ id: "existing-job", status: "pending" }]);
  });
});

describe("article reads", () => {
  it("returns stored articles without contacting external feeds", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Feed server unavailable"));
    const send = vi.fn();
    try {
      const response = await api.request("http://localhost/api/v1/articles", {}, {
        DB: mockDatabase(), JOBS: { send },
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
