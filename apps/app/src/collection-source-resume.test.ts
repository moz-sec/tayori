import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";
import { api } from "./api";

const migrations = new URL("../../../migrations/", import.meta.url);
const migration = readFileSync(new URL("0005_remove_paused_sources.sql", migrations), "utf8");

/** Builds the pre-migration schema so existing rows and foreign keys can be checked. */
function oldDatabase() {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_collection_schedule.sql",
    "0004_remove_boards.sql",
  ]) {
    db.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  return db;
}

describe("removing the paused subscription state", () => {
  it("retains existing articles and jobs while rejecting new paused states", () => {
    const db = oldDatabase();
    try {
      db.exec(`INSERT INTO sources(id, title, normalized_url) VALUES ('s', 'Feed', 'https://example.com/feed');
        INSERT INTO item_keys(id, source_id, key_hash, first_seen_at) VALUES ('a', 's', 'key', 1);
        INSERT INTO articles(id, title, url, first_seen_at, expires_at) VALUES ('a', 'Article', 'https://example.com/a', 1, 2);
        INSERT INTO fetch_jobs(id, source_id, generation, status) VALUES ('j', 's', 1, 'pending');`);
      db.exec(migration);
      expect(db.prepare("SELECT COUNT(*) AS n FROM articles").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM fetch_jobs").get()).toEqual({ n: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() => db.exec("UPDATE sources SET status = 'paused' WHERE id = 's'")).toThrow();
      expect(() =>
        db.exec(
          "INSERT INTO sources(id,title,normalized_url,status) VALUES ('p','P','https://example.com/p','paused')",
        ),
      ).toThrow();
      db.exec("UPDATE sources SET status = 'archived' WHERE id = 's'");
      expect(db.prepare("SELECT status FROM sources WHERE id = 's'").get()).toEqual({
        status: "archived",
      });
    } finally {
      db.close();
    }
  });
  it("stops rather than silently changing any existing paused subscription", () => {
    const db = oldDatabase();
    try {
      db.exec(
        "INSERT INTO sources(id,title,normalized_url,status) VALUES ('p','P','https://example.com/p','paused')",
      );
      expect(() => db.exec(migration)).toThrow();
      expect(db.prepare("SELECT status FROM sources WHERE id = 'p'").get()).toEqual({
        status: "paused",
      });
    } finally {
      db.close();
    }
  });
  it("converts only the known local demo feeds without scheduling an immediate fetch", () => {
    const db = oldDatabase();
    try {
      db.exec(
        "INSERT INTO sources(id,title,normalized_url,status,next_fetch_at) VALUES ('demo-cncf','Demo','https://tayori.invalid/tayori-demo/cncf.xml','paused',1)",
      );
      db.exec(migration);
      expect(
        db.prepare("SELECT status, next_fetch_at FROM sources WHERE id = 'demo-cncf'").get(),
      ).toEqual({ status: "active", next_fetch_at: 4102444800 });
    } finally {
      db.close();
    }
  });
  it("allows local fixtures to be seeded after the migration", () => {
    const db = sqliteD1();
    try {
      db.sqlite.exec(
        readFileSync(new URL("../../../scripts/seed-local.sql", import.meta.url), "utf8"),
      );
      expect(
        db.sqlite.prepare("SELECT count(*) AS n FROM sources WHERE status = 'active'").get(),
      ).toEqual({ n: 4 });
    } finally {
      db.sqlite.close();
    }
  });
  it("rejects attempts to change subscription status through the update API", async () => {
    const db = sqliteD1();
    try {
      db.sqlite.exec(
        "INSERT INTO sources(id,title,normalized_url) VALUES ('s','Feed','https://example.com/feed')",
      );
      const response = await api.request(
        "http://localhost/api/v1/sources/s",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ status: "paused" }),
        },
        { DB: db.binding } as Env,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_SOURCE_STATUS");
      expect(db.sqlite.prepare("SELECT status FROM sources WHERE id = 's'").get()).toEqual({
        status: "active",
      });
    } finally {
      db.sqlite.close();
    }
  });
});
