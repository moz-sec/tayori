import { describe, expect, it } from "vitest";
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
      const response = await api.request("http://localhost/api/v1/sources/source", { method: "PATCH", headers, body: JSON.stringify({ title: "新しい名前", folderId: "folder" }) }, { DB: db.binding } as Env);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ id: "source", title: "新しい名前", folderId: "folder", url: "https://example.com/feed" });
      expect(db.sqlite.prepare("SELECT title_is_custom, generation FROM sources WHERE id = 'source'").get()).toMatchObject({ title_is_custom: 1, generation: 2 });
      const unclassified = await api.request("http://localhost/api/v1/sources/source", { method: "PATCH", headers, body: JSON.stringify({ title: "新しい名前", folderId: null }) }, { DB: db.binding } as Env);
      expect((await unclassified.json()).data.folderId).toBeNull();
      expect(db.sqlite.prepare("SELECT read_at, starred, read_later FROM articles WHERE id = 'article'").get()).toMatchObject({ read_at: 123, starred: 1, read_later: 1 });
    } finally { db.sqlite.close(); }
  });

  it("rejects a missing folder without changing the existing subscription", async () => {
    const db = database();
    try {
      const response = await api.request("http://localhost/api/v1/sources/source", { method: "PATCH", headers, body: JSON.stringify({ title: "入力中の名前", folderId: "deleted" }) }, { DB: db.binding } as Env);
      expect(response.status).toBe(404);
      expect(db.sqlite.prepare("SELECT title, folder_id, generation FROM sources WHERE id = 'source'").get()).toMatchObject({ title: "元の名前", folder_id: null, generation: 1 });
    } finally { db.sqlite.close(); }
  });

  it("archives idempotently and preserves articles and reading state for the global list", async () => {
    const db = database();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await api.request("http://localhost/api/v1/sources/source", { method: "DELETE", headers }, { DB: db.binding } as Env);
        expect(response.status).toBe(204);
      }
      expect(db.sqlite.prepare("SELECT status, generation FROM sources WHERE id = 'source'").get()).toMatchObject({ status: "archived", generation: 2 });
      expect(db.sqlite.prepare("SELECT count(*) AS count FROM sources WHERE status = 'active'").get()).toMatchObject({ count: 0 });
      const response = await api.request("http://localhost/api/v1/articles?scope=all", {}, { DB: db.binding } as Env);
      expect((await response.json()).data).toEqual([expect.objectContaining({ id: "article", read: true, starred: true, readLater: true })]);
    } finally { db.sqlite.close(); }
  });
});
