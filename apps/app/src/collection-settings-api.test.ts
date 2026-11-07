import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLLECTION_SCHEDULE } from "@tayori/shared/collection-schedule";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";
import { api } from "./api";

const endpoint = "http://localhost/api/v1/settings/collection-schedule";
const headers = { "Content-Type": "application/json", Origin: "http://localhost" };
const daily = { mode: "daily", interval_hours: 6, daily_hour_jst: 0, timezone: "Asia/Tokyo" };
afterEach(() => vi.restoreAllMocks());

describe("collection settings API", () => {
  it("uses the hourly default and no next time when no active subscriptions exist", async () => {
    const db = sqliteD1();
    try {
      const response = await api.request(endpoint, {}, { DB: db.binding } as Env);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        ...DEFAULT_COLLECTION_SCHEDULE,
        next_fetch_at: null,
      });
    } finally {
      db.sqlite.close();
    }
  });

  it("persists across reads, reschedules atomically, and retains in-flight jobs and retry deadlines", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-05T14:30:00Z"));
    const db = sqliteD1();
    const jobs = { send: vi.fn() };
    try {
      db.sqlite.exec(`
        INSERT INTO sources(id,title,normalized_url,next_fetch_at,retry_not_before) VALUES
          ('active','正常','https://example.com/a',1,NULL),
          ('retry','再試行','https://example.com/b',1,1793898000);
        INSERT INTO fetch_jobs(id,source_id,generation,status,lease_until) VALUES ('running','active',1,'running',1793889900);
      `);
      const env = { DB: db.binding, JOBS: jobs } as unknown as Env;
      const response = await api.request(
        endpoint,
        { method: "PUT", headers, body: JSON.stringify(daily) },
        env,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        ...daily,
        next_fetch_at: "2026-11-05T15:00:00.000Z",
      });
      expect(db.sqlite.prepare("SELECT next_fetch_at FROM sources WHERE id='retry'").get()).toEqual(
        { next_fetch_at: 1793898000 },
      );
      expect(
        db.sqlite.prepare("SELECT status, generation FROM fetch_jobs WHERE id='running'").get(),
      ).toEqual({ status: "running", generation: 1 });
      const read = await api.request(endpoint, {}, env);
      expect((await read.json()).data.mode).toBe("daily");
      expect(jobs.send).not.toHaveBeenCalled();
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fetch_jobs").get()).toEqual({ n: 1 });
    } finally {
      db.sqlite.close();
    }
  });

  it("rolls back the saved setting if rescheduling fails", async () => {
    const db = sqliteD1();
    try {
      db.sqlite.exec(
        "INSERT INTO sources(id,title,normalized_url) VALUES ('source','test','https://example.com/feed')",
      );
      db.state.beforeQuery = (sql) => {
        if (sql.startsWith("UPDATE sources SET next_fetch_at"))
          throw new Error("database unavailable");
      };
      const response = await api.request(
        endpoint,
        { method: "PUT", headers, body: JSON.stringify(daily) },
        { DB: db.binding } as Env,
      );
      expect(response.status).toBe(500);
      expect(
        db.sqlite.prepare("SELECT value FROM app_state WHERE key='collection_schedule'").get(),
      ).toBeUndefined();
    } finally {
      db.sqlite.close();
    }
  });

  it.each([
    {},
    null,
    [],
    { ...daily, interval_hours: 5 },
    { ...daily, daily_hour_jst: 24 },
    { ...daily, daily_hour_jst: 1.5 },
    { ...daily, daily_hour_jst: "0" },
    { ...daily, mode: "weekly" },
    { ...daily, timezone: "UTC" },
  ])("rejects invalid settings without persisting: %j", async (input) => {
    const db = sqliteD1();
    try {
      const response = await api.request(
        endpoint,
        { method: "PUT", headers, body: JSON.stringify(input) },
        { DB: db.binding } as Env,
      );
      expect(response.status).toBe(400);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM app_state").get()).toEqual({ n: 0 });
    } finally {
      db.sqlite.close();
    }
  });

  it("rejects malformed and oversized JSON", async () => {
    const db = sqliteD1();
    try {
      for (const [body, status] of [
        ["{", 400],
        [JSON.stringify({ ...daily, extra: "a".repeat(4100) }), 413],
      ] as const) {
        const response = await api.request(endpoint, { method: "PUT", headers, body }, {
          DB: db.binding,
        } as Env);
        expect(response.status).toBe(status);
      }
    } finally {
      db.sqlite.close();
    }
  });

  it("inherits Access authentication, origin checks and JSON requirements", async () => {
    const db = sqliteD1();
    try {
      const env = { DB: db.binding } as Env;
      expect(
        (await api.request(endpoint.replace("localhost", "tayori.example.com"), {}, env)).status,
      ).toBe(503);
      expect(
        (
          await api.request(
            endpoint,
            {
              method: "PUT",
              headers: { ...headers, Origin: "https://other.example" },
              body: JSON.stringify(daily),
            },
            env,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api.request(
            endpoint,
            {
              method: "PUT",
              headers: { Origin: "http://localhost", "Content-Type": "text/plain" },
              body: "{}",
            },
            env,
          )
        ).status,
      ).toBe(415);
    } finally {
      db.sqlite.close();
    }
  });
});
