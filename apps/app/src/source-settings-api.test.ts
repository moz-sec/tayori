import { describe, expect, it, vi } from "vitest";
import type { QueueMessage } from "@tayori/shared";
import collector from "../../collector/src/index";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";
import { api } from "./api";

/** Seeds a subscription and saved article to verify management does not discard reading state. */
function database() {
  const db = sqliteD1();
  db.sqlite.exec(`
    INSERT INTO folders(id, name) VALUES ('folder', '移動先');
    INSERT INTO sources(id, title, normalized_url) VALUES ('source', '元の名前', 'https://example.com/feed');
    INSERT INTO item_keys(id, source_id, key_hash, first_seen_at) VALUES ('article', 'source', 'hash', unixepoch());
    INSERT INTO articles(id, title, url, first_seen_at, expires_at, read_at, starred, read_later)
      VALUES ('article', '記事', 'https://example.com/article', unixepoch(), unixepoch() + 3600, 123, 1, 1);
  `);
  return db;
}
const headers = { "Content-Type": "application/json", Origin: "http://localhost" };

describe("subscription management API", () => {
  it("renames and moves a feed, including back to unclassified, without changing its URL or articles", async () => {
    const db = database();
    try {
      const response = await api.request(
        "http://localhost/api/v1/sources/source",
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "新しい名前", folderId: "folder" }),
        },
        { DB: db.binding } as Env,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        id: "source",
        title: "新しい名前",
        folderId: "folder",
        url: "https://example.com/feed",
      });
      expect(
        db.sqlite
          .prepare("SELECT title_is_custom, generation FROM sources WHERE id = 'source'")
          .get(),
      ).toMatchObject({ title_is_custom: 1, generation: 2 });
      const unclassified = await api.request(
        "http://localhost/api/v1/sources/source",
        { method: "PATCH", headers, body: JSON.stringify({ title: "新しい名前", folderId: null }) },
        { DB: db.binding } as Env,
      );
      expect((await unclassified.json()).data.folderId).toBeNull();
      expect(
        db.sqlite
          .prepare("SELECT read_at, starred, read_later FROM articles WHERE id = 'article'")
          .get(),
      ).toMatchObject({ read_at: 123, starred: 1, read_later: 1 });
    } finally {
      db.sqlite.close();
    }
  });

  it("rejects a missing folder without changing the existing subscription", async () => {
    const db = database();
    try {
      const response = await api.request(
        "http://localhost/api/v1/sources/source",
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "入力中の名前", folderId: "deleted" }),
        },
        { DB: db.binding } as Env,
      );
      expect(response.status).toBe(404);
      expect(
        db.sqlite
          .prepare("SELECT title, folder_id, generation FROM sources WHERE id = 'source'")
          .get(),
      ).toMatchObject({ title: "元の名前", folder_id: null, generation: 1 });
    } finally {
      db.sqlite.close();
    }
  });

  it("archives idempotently and preserves articles and reading state for the global list", async () => {
    const db = database();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await api.request(
          "http://localhost/api/v1/sources/source",
          { method: "DELETE", headers },
          { DB: db.binding } as Env,
        );
        expect(response.status).toBe(204);
      }
      expect(
        db.sqlite.prepare("SELECT status, generation FROM sources WHERE id = 'source'").get(),
      ).toMatchObject({ status: "archived", generation: 2 });
      expect(
        db.sqlite.prepare("SELECT count(*) AS count FROM sources WHERE status = 'active'").get(),
      ).toMatchObject({ count: 0 });
      const response = await api.request("http://localhost/api/v1/articles?scope=all", {}, {
        DB: db.binding,
      } as Env);
      expect((await response.json()).data).toEqual([
        expect.objectContaining({ id: "article", read: true, starred: true, readLater: true }),
      ]);
    } finally {
      db.sqlite.close();
    }
  });
});

describe("subscription URL correction", () => {
  /** Sends a source update using the current generation unless a stale value is supplied. */
  function patch(
    db: ReturnType<typeof database>,
    body: unknown,
    send = vi.fn().mockResolvedValue(undefined),
  ) {
    return api.request(
      "http://localhost/api/v1/sources/source",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          expectedGeneration: db.sqlite
            .prepare("SELECT generation FROM sources WHERE id = 'source'")
            .get()!.generation,
          ...(body as Record<string, unknown>),
        }),
      },
      { DB: db.binding, JOBS: { send } } as unknown as Env,
    );
  }

  function oldJob(db: ReturnType<typeof database>, status = "sent") {
    db.sqlite.exec(`UPDATE sources SET etag = 'old-etag', last_modified = 'old-modified',
      last_checked_at = 120, last_success_at = 100, site_url = 'https://example.com/old',
      consecutive_failures = 3, last_error_code = 'http_503', last_error_at = 120`);
    db.sqlite
      .prepare(
        "INSERT INTO fetch_jobs(id, source_id, generation, status, lease_until) VALUES ('old-job', 'source', 1, ?, 9999999999)",
      )
      .run(status);
  }

  async function deliver(db: ReturnType<typeof database>, body: QueueMessage, send = vi.fn()) {
    db.state.queries = 0;
    await collector.queue(
      {
        queue: "test-jobs",
        messages: [
          {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            body,
            attempts: 1,
            ack() {},
            retry() {},
          },
        ],
        ackAll() {},
        retryAll() {},
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      },
      { DB: db.binding, JOBS: { send } } as unknown as Env,
    );
  }

  it("rejects a stale editor snapshot and preserves the newer URL, validators, jobs, and reading state", async () => {
    const db = database();
    try {
      const list = await api.request("http://localhost/api/v1/sources", {}, {
        DB: db.binding,
      } as Env);
      const opened = (await list.json()).data[0];
      expect(opened.generation).toBe(1);
      const first = await patch(db, {
        url: "https://example.com/first.xml",
        expectedGeneration: opened.generation,
      });
      expect(first.status).toBe(200);
      expect((await first.json()).data.generation).toBe(2);
      db.sqlite.exec(`UPDATE sources SET etag = 'new-etag', last_modified = 'new-modified';
        UPDATE fetch_jobs SET id = 'new-job' WHERE source_id = 'source' AND generation = 2;`);
      const stale = await patch(db, {
        url: "https://example.com/stale.xml",
        expectedGeneration: opened.generation,
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "SOURCE_VERSION_CONFLICT" } });
      expect(
        db.sqlite
          .prepare("SELECT normalized_url, etag, last_modified, generation FROM sources")
          .get(),
      ).toEqual({
        normalized_url: "https://example.com/first.xml",
        etag: "new-etag",
        last_modified: "new-modified",
        generation: 2,
      });
      expect(db.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id = 'new-job'").get()).toEqual(
        { status: "sent" },
      );
      expect(db.sqlite.prepare("SELECT read_at, starred, read_later FROM articles").get()).toEqual({
        read_at: 123,
        starred: 1,
        read_later: 1,
      });
      const latest = await api.request("http://localhost/api/v1/sources", {}, {
        DB: db.binding,
      } as Env);
      const current = (await latest.json()).data[0];
      expect(
        (
          await patch(db, {
            url: "https://example.com/accepted.xml",
            expectedGeneration: current.generation,
          })
        ).status,
      ).toBe(200);
    } finally {
      db.sqlite.close();
    }
  });

  it("requires an editor generation whenever a URL is supplied", async () => {
    const db = database();
    try {
      const response = await patch(db, {
        url: "https://example.com/new.xml",
        expectedGeneration: undefined,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "EXPECTED_SOURCE_GENERATION_REQUIRED" },
      });
      expect(db.sqlite.prepare("SELECT generation, normalized_url FROM sources").get()).toEqual({
        generation: 1,
        normalized_url: "https://example.com/feed",
      });
    } finally {
      db.sqlite.close();
    }
  });

  it.each([null, "1", 0, -1, 1.5, 2_147_483_648])(
    "rejects an invalid editor generation: %j",
    async (expectedGeneration) => {
      const db = database();
      try {
        const response = await patch(db, {
          url: "https://example.com/new.xml",
          expectedGeneration,
        });
        expect(response.status).toBe(400);
        expect(db.sqlite.prepare("SELECT generation FROM sources").get()).toEqual({
          generation: 1,
        });
      } finally {
        db.sqlite.close();
      }
    },
  );

  it("uses the editor generation for non-URL changes as well", async () => {
    const db = database();
    try {
      expect((await patch(db, { title: "他端末の名前", expectedGeneration: 1 })).status).toBe(200);
      expect(
        (await patch(db, { title: "古い画面の名前", folderId: "folder", expectedGeneration: 1 }))
          .status,
      ).toBe(409);
      expect(db.sqlite.prepare("SELECT title, folder_id, generation FROM sources").get()).toEqual({
        title: "他端末の名前",
        folder_id: null,
        generation: 2,
      });
    } finally {
      db.sqlite.close();
    }
  });

  it("does not overwrite another mutation racing with a non-URL save", async () => {
    const db = database();
    let raced = false;
    db.state.beforeQuery = (sql) => {
      if (!raced && sql.includes("UPDATE sources SET folder_id")) {
        raced = true;
        db.sqlite.exec("UPDATE sources SET title = '最新の名前', generation = 2");
      }
    };
    try {
      expect((await patch(db, { title: "古い名前", expectedGeneration: 1 })).status).toBe(409);
      expect(db.sqlite.prepare("SELECT title, generation FROM sources").get()).toEqual({
        title: "最新の名前",
        generation: 2,
      });
    } finally {
      db.sqlite.close();
    }
  });

  it("normalizes a corrected URL, resets old validators and diagnostics, and preserves article keys and state", async () => {
    const db = database();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-06T01:22:00Z"));
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Must not fetch from PATCH"));
    try {
      oldJob(db);
      const response = await patch(db, { url: "HTTPS://Example.COM:443/new.xml#fragment" });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        id: "source",
        url: "https://example.com/new.xml",
        errorCode: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        nextFetchAt: "2026-11-06T01:22:00.000Z",
      });
      expect(
        db.sqlite
          .prepare(
            "SELECT generation, etag, last_modified, site_url FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toEqual({ generation: 2, etag: null, last_modified: null, site_url: null });
      expect(
        db.sqlite.prepare("SELECT status, lease_until FROM fetch_jobs WHERE id = 'old-job'").get(),
      ).toEqual({ status: "failed", lease_until: null });
      expect(
        db.sqlite.prepare("SELECT source_id, key_hash FROM item_keys WHERE id = 'article'").get(),
      ).toEqual({ source_id: "source", key_hash: "hash" });
      expect(
        db.sqlite
          .prepare("SELECT read_at, starred, read_later FROM articles WHERE id = 'article'")
          .get(),
      ).toEqual({ read_at: 123, starred: 1, read_later: 1 });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      fetcher.mockRestore();
      db.sqlite.close();
    }
  });

  it.each([
    null,
    123,
    "",
    "not-a-url",
    "file:///etc/passwd",
    "http://localhost/feed",
    "http://127.0.0.1/feed",
    "https://user:password@example.com/feed",
    "https://example.com/" + "a".repeat(2048),
  ])("rejects an invalid or non-public URL: %s", async (url) => {
    const db = database();
    try {
      const response = await patch(db, { url });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_FEED_URL" } });
      expect(
        db.sqlite
          .prepare("SELECT normalized_url, generation FROM sources WHERE id = 'source'")
          .get(),
      ).toEqual({ normalized_url: "https://example.com/feed", generation: 1 });
    } finally {
      db.sqlite.close();
    }
  });

  it("returns 409 for another subscription's URL and rolls back source and job changes", async () => {
    const db = database();
    try {
      oldJob(db);
      db.sqlite.exec(
        "INSERT INTO sources(id, title, normalized_url) VALUES ('other', 'Other', 'https://example.com/other.xml')",
      );
      const response = await patch(db, {
        url: "https://EXAMPLE.com/other.xml#ignored",
        title: "Must not save",
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_ALREADY_EXISTS" } });
      expect(
        db.sqlite
          .prepare(
            "SELECT title, normalized_url, generation, etag FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toMatchObject({
        title: "元の名前",
        normalized_url: "https://example.com/feed",
        generation: 1,
        etag: "old-etag",
      });
      expect(db.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id = 'old-job'").get()).toEqual(
        { status: "sent" },
      );
    } finally {
      db.sqlite.close();
    }
  });

  it("keeps URL-specific validators when the normalized URL is unchanged", async () => {
    const db = database();
    try {
      oldJob(db);
      const response = await patch(db, { url: "https://EXAMPLE.com:443/feed#ignored" });
      expect(response.status).toBe(200);
      expect(
        db.sqlite
          .prepare(
            "SELECT normalized_url, etag, last_modified, consecutive_failures FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toEqual({
        normalized_url: "https://example.com/feed",
        etag: "old-etag",
        last_modified: "old-modified",
        consecutive_failures: 3,
      });
    } finally {
      db.sqlite.close();
    }
  });

  it("queues immediately after URL correction and clears the old URL's backoff", async () => {
    const db = database();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-06T01:22:00Z"));
    try {
      db.sqlite.prepare("INSERT INTO app_state(key, value) VALUES ('collection_schedule', ?)").run(
        JSON.stringify({
          mode: "daily",
          interval_hours: 1,
          daily_hour_jst: 9,
          timezone: "Asia/Tokyo",
        }),
      );
      db.sqlite.exec("UPDATE sources SET retry_not_before = 9999999999");
      const response = await patch(db, { url: "https://example.com/new.xml" });
      expect(response.status).toBe(200);
      expect((await response.json()).data.nextFetchAt).toBe("2026-11-06T01:22:00.000Z");
      expect(
        db.sqlite.prepare("SELECT retry_not_before FROM sources WHERE id = 'source'").get(),
      ).toEqual({ retry_not_before: null });
    } finally {
      clock.mockRestore();
      db.sqlite.close();
    }
  });

  it("queues the new generation and ignores the old job after a URL change", async () => {
    const db = database();
    const send = vi.fn().mockResolvedValue(undefined);
    try {
      oldJob(db);
      expect((await patch(db, { url: "https://example.com/new.xml" }, send)).status).toBe(200);
      const job = db.sqlite
        .prepare(
          "SELECT id, generation, status FROM fetch_jobs WHERE source_id = 'source' AND id != 'old-job'",
        )
        .get();
      expect(job).toMatchObject({ generation: 2, status: "sent" });
      expect(send).toHaveBeenCalledExactlyOnceWith({
        schemaVersion: 1,
        type: "fetch",
        jobId: job!.id,
      });
      expect(db.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id = 'old-job'").get()).toEqual(
        { status: "failed" },
      );
    } finally {
      db.sqlite.close();
    }
  });

  it("does not enqueue a paused subscription after a URL change", async () => {
    const db = database();
    const send = vi.fn();
    try {
      db.sqlite.exec("UPDATE sources SET status = 'paused'");
      expect((await patch(db, { url: "https://example.com/new.xml" }, send)).status).toBe(200);
      expect(send).not.toHaveBeenCalled();
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM fetch_jobs").get()).toEqual({ n: 0 });
    } finally {
      db.sqlite.close();
    }
  });

  it("fetches the corrected URL and schedules the following regular collection", async () => {
    const db = database();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-06T01:22:00Z"));
    const send = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          '<rss version="2.0"><channel><title>New feed</title><item><guid>new</guid><title>New article</title><link>https://example.com/new-article</link></item></channel></rss>',
          { status: 200 },
        ),
      );
    try {
      expect((await patch(db, { url: "https://example.com/new.xml" }, send)).status).toBe(200);
      await deliver(db, send.mock.calls[0]![0]);
      expect(fetcher).toHaveBeenCalledWith("https://example.com/new.xml", expect.anything());
      expect(
        db.sqlite.prepare("SELECT count(*) AS n FROM articles WHERE title = 'New article'").get(),
      ).toEqual({ n: 1 });
      expect(
        db.sqlite.prepare("SELECT next_fetch_at FROM sources WHERE id = 'source'").get(),
      ).toEqual({ next_fetch_at: Date.parse("2026-11-06T02:00:00Z") / 1000 });
    } finally {
      fetcher.mockRestore();
      clock.mockRestore();
      db.sqlite.close();
    }
  });

  it("keeps the corrected URL and a recoverable pending job if queue delivery fails", async () => {
    const db = database();
    const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await patch(db, { url: "https://example.com/new.xml" }, send)).status).toBe(200);
      expect(
        db.sqlite
          .prepare(
            "SELECT normalized_url, next_fetch_at <= unixepoch() AS due FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toEqual({ normalized_url: "https://example.com/new.xml", due: 1 });
      expect(
        db.sqlite
          .prepare("SELECT status, generation FROM fetch_jobs WHERE source_id = 'source'")
          .get(),
      ).toEqual({ status: "pending", generation: 2 });
    } finally {
      log.mockRestore();
      db.sqlite.close();
    }
  });

  it("rolls back a URL update if invalidating its old job fails", async () => {
    const db = database();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      oldJob(db);
      db.sqlite.exec(
        "CREATE TRIGGER prevent_job_change BEFORE UPDATE ON fetch_jobs BEGIN SELECT RAISE(ABORT, 'job failure'); END",
      );
      const response = await patch(db, { url: "https://example.com/new.xml" });
      expect(response.status).toBe(500);
      expect(
        db.sqlite
          .prepare("SELECT normalized_url, etag, generation FROM sources WHERE id = 'source'")
          .get(),
      ).toEqual({ normalized_url: "https://example.com/feed", etag: "old-etag", generation: 1 });
      expect(db.sqlite.prepare("SELECT status FROM fetch_jobs WHERE id = 'old-job'").get()).toEqual(
        { status: "sent" },
      );
    } finally {
      log.mockRestore();
      db.sqlite.close();
    }
  });

  it("reports a concurrent subscription update instead of overwriting it", async () => {
    const db = database();
    let raced = false;
    db.state.beforeQuery = (sql) => {
      if (!raced && sql.includes("UPDATE sources SET folder_id")) {
        raced = true;
        db.sqlite.exec("UPDATE sources SET generation = generation + 1, title = '別端末の名前'");
      }
    };
    try {
      const response = await patch(db, { url: "https://example.com/new.xml" });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_VERSION_CONFLICT" } });
      expect(
        db.sqlite.prepare("SELECT title, normalized_url FROM sources WHERE id = 'source'").get(),
      ).toEqual({ title: "別端末の名前", normalized_url: "https://example.com/feed" });
    } finally {
      db.sqlite.close();
    }
  });

  it("retains a newer collection schedule racing with a URL change", async () => {
    const db = database();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-06T01:22:00Z"));
    const next = Date.parse("2026-11-07T00:00:00Z") / 1000;
    let raced = false;
    db.state.beforeQuery = (sql) => {
      if (!raced && sql.includes("UPDATE sources SET folder_id")) {
        raced = true;
        // Reproduce a setting PUT after the schedule read and before the mutation batch.
        db.sqlite
          .prepare("INSERT INTO app_state(key, value) VALUES ('collection_schedule', ?)")
          .run(
            JSON.stringify({
              mode: "daily",
              interval_hours: 1,
              daily_hour_jst: 9,
              timezone: "Asia/Tokyo",
            }),
          );
        db.sqlite.prepare("UPDATE sources SET next_fetch_at = ?").run(next);
      }
    };
    try {
      const response = await patch(db, { url: "https://example.com/new.xml" });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_VERSION_CONFLICT" } });
      expect(
        db.sqlite
          .prepare(
            "SELECT normalized_url, next_fetch_at, generation, status FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toEqual({
        normalized_url: "https://example.com/feed",
        next_fetch_at: next,
        generation: 1,
        status: "active",
      });
    } finally {
      clock.mockRestore();
      db.sqlite.close();
    }
  });

  it("ignores an old queued delivery after the URL changes", async () => {
    const db = database();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Must not fetch old URL"));
    try {
      oldJob(db);
      expect((await patch(db, { url: "https://example.com/new.xml" })).status).toBe(200);
      await deliver(db, { schemaVersion: 1, type: "fetch", jobId: "old-job" });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
      db.sqlite.close();
    }
  });

  it("discards an old response arriving after the URL changes during fetch", async () => {
    const db = database();
    let corrected: Response | undefined;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      corrected = await patch(db, { url: "https://example.com/new.xml" });
      return new Response(
        '<rss version="2.0"><channel><title>Old URL</title><item><guid>stale</guid><title>Stale</title><link>https://example.com/stale</link></item></channel></rss>',
        {
          headers: { etag: "stale-etag" },
        },
      );
    });
    try {
      oldJob(db);
      await deliver(db, { schemaVersion: 1, type: "fetch", jobId: "old-job" });
      expect(corrected?.status).toBe(200);
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM item_keys").get()).toEqual({ n: 1 });
      expect(
        db.sqlite
          .prepare(
            "SELECT title, normalized_url, etag, last_success_at FROM sources WHERE id = 'source'",
          )
          .get(),
      ).toEqual({
        title: "元の名前",
        normalized_url: "https://example.com/new.xml",
        etag: null,
        last_success_at: null,
      });
    } finally {
      fetcher.mockRestore();
      db.sqlite.close();
    }
  });

  it("documents URL input and URL conflicts in OpenAPI", async () => {
    const response = await api.request("http://localhost/api/v1/openapi.json", {}, {} as Env);
    const document = await response.json();
    const operation = document.paths["/api/v1/sources/{id}"].patch;
    expect(operation.requestBody.content["application/json"].schema.properties.url).toMatchObject({
      type: "string",
      maxLength: 2048,
    });
    expect(
      operation.requestBody.content["application/json"].schema.properties.expectedGeneration,
    ).toMatchObject({ type: "integer", minimum: 1 });
    expect(
      document.paths["/api/v1/sources"].get.responses["200"].content["application/json"].schema
        .properties.data.items.properties.generation,
    ).toMatchObject({ type: "integer", minimum: 1 });
    expect(operation.responses["409"]).toBeDefined();
  });
});
