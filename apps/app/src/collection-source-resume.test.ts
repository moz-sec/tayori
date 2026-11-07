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

describe("subscription schedule on resume", () => {
  function patch(db: ReturnType<typeof database>, body: unknown) {
    return api.request("http://localhost/api/v1/sources/source", {
      method: "PATCH", headers, body: JSON.stringify(body),
    }, { DB: db.binding } as Env);
  }

  async function deliver(db: ReturnType<typeof database>, body: QueueMessage, send = vi.fn()) {
    db.state.queries = 0;
    await collector.queue({
      queue: "test-jobs", messages: [{
        id: crypto.randomUUID(), timestamp: new Date(), body, attempts: 1, ack() {}, retry() {},
      }], ackAll() {}, retryAll() {}, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    }, { DB: db.binding, JOBS: { send } } as unknown as Env);
  }

  it.each([
    { retryAt: "2026-11-06T03:22:00Z", expected: "2026-11-07T00:00:00.000Z" },
    { retryAt: "2026-11-08T03:00:00Z", expected: "2026-11-08T03:00:00.000Z" },
  ])("resumes after both the daily boundary and retry deadline: $retryAt", async ({ retryAt: retryIso, expected }) => {
    const db = database();
    const at = Date.parse("2026-11-06T01:22:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const send = vi.fn();
    try {
      db.sqlite.prepare("INSERT INTO app_state(key, value) VALUES ('collection_schedule', ?)").run(JSON.stringify({
        mode: "daily", interval_hours: 1, daily_hour_jst: 9, timezone: "Asia/Tokyo",
      }));
      const retryAt = Date.parse(retryIso) / 1000;
      db.sqlite.prepare("UPDATE sources SET status = 'paused', next_fetch_at = 0, retry_not_before = ?").run(retryAt);
      const response = await patch(db, { status: "active" });
      expect(response.status).toBe(200);
      expect((await response.json()).data.nextFetchAt).toBe(expected);
      expect(db.sqlite.prepare("SELECT status, retry_not_before FROM sources WHERE id = 'source'").get())
        .toEqual({ status: "active", retry_not_before: retryAt });
      await deliver(db, { schemaVersion: 1, type: "tick", scheduledAt: Date.parse("2026-11-06T01:00:00Z") }, send);
      expect(send).not.toHaveBeenCalled();
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM fetch_jobs").get()).toEqual({ n: 0 });
    } finally { clock.mockRestore(); db.sqlite.close(); }
  });

  it("retains a newer collection schedule racing with resume", async () => {
    const db = database();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-06T01:22:00Z"));
    const next = Date.parse("2026-11-07T00:00:00Z") / 1000;
    let raced = false;
    db.sqlite.exec("UPDATE sources SET status = 'paused'");
    db.state.beforeQuery = (sql) => {
      if (!raced && sql.includes("UPDATE sources SET folder_id")) {
        raced = true;
        // Reproduce a setting PUT after the schedule read and before the mutation batch.
        db.sqlite.prepare("INSERT INTO app_state(key, value) VALUES ('collection_schedule', ?)").run(JSON.stringify({
          mode: "daily", interval_hours: 1, daily_hour_jst: 9, timezone: "Asia/Tokyo",
        }));
        db.sqlite.prepare("UPDATE sources SET next_fetch_at = ?").run(next);
      }
    };
    try {
      const response = await patch(db, { status: "active" });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_VERSION_CONFLICT" } });
      expect(db.sqlite.prepare("SELECT normalized_url, next_fetch_at, generation, status FROM sources WHERE id = 'source'").get())
        .toEqual({ normalized_url: "https://example.com/feed", next_fetch_at: next, generation: 1, status: "paused" });
    } finally { clock.mockRestore(); db.sqlite.close(); }
  });

});
