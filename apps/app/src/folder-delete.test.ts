import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

function deletionRequest(id: string) {
  return new Request(`http://localhost/api/v1/folders/${id}`, { method: "DELETE", headers: { Origin: "http://localhost" } });
}

/** Uses real constraints and atomic batches to verify folder deletion never loses its contents. */
describe("folder deletion", () => {
  it.each([null, "parent"])("moves children and feeds to %s while preserving article state", async (parentId) => {
    const database = sqliteD1();
    try {
      database.sqlite.exec("INSERT INTO folders(id,name) VALUES ('parent','Parent')");
      database.sqlite.prepare("INSERT INTO folders(id,name,parent_id) VALUES ('removed','Removed',?)").run(parentId);
      database.sqlite.exec(`
        INSERT INTO folders(id,name,parent_id) VALUES ('child','Child','removed'), ('grandchild','Grandchild','child');
        INSERT INTO sources(id,title,normalized_url,folder_id) VALUES ('feed','Feed','https://example.com/rss','removed'), ('child-feed','Child feed','https://example.com/child','child');
        INSERT INTO item_keys(id,source_id,key_hash,first_seen_at) VALUES ('article','feed','key',1);
        INSERT INTO articles(id,title,url,first_seen_at,expires_at,read_at,starred,read_later) VALUES ('article','Article','https://example.com/a',1,2,1,1,1);
      `);
      const response = await api.request(deletionRequest('removed'), {}, { DB: database.binding } as Env);
      expect(response.status).toBe(204);
      expect(database.sqlite.prepare("SELECT id FROM folders WHERE id='removed'").get()).toBeUndefined();
      expect(database.sqlite.prepare("SELECT parent_id FROM folders WHERE id='child'").get()?.parent_id).toBe(parentId);
      expect(database.sqlite.prepare("SELECT parent_id FROM folders WHERE id='grandchild'").get()?.parent_id).toBe('child');
      expect(database.sqlite.prepare("SELECT folder_id FROM sources WHERE id='feed'").get()?.folder_id).toBe(parentId);
      expect(database.sqlite.prepare("SELECT folder_id FROM sources WHERE id='child-feed'").get()?.folder_id).toBe('child');
      expect(database.sqlite.prepare("SELECT read_at,starred,read_later FROM articles WHERE id='article'").get()).toMatchObject({ read_at: 1, starred: 1, read_later: 1 });
    } finally { database.sqlite.close(); }
  });

  it.each([null, "parent"])("returns 409 without moving anything when the destination %s has a duplicate", async (parentId) => {
    const database = sqliteD1();
    try {
      database.sqlite.exec("INSERT INTO folders(id,name) VALUES ('parent','Parent')");
      database.sqlite.prepare("INSERT INTO folders(id,name,parent_id) VALUES ('removed','Removed',?), ('duplicate','CHILD',?)").run(parentId, parentId);
      database.sqlite.exec(`
        INSERT INTO folders(id,name,parent_id) VALUES ('child','Child','removed');
        INSERT INTO sources(id,title,normalized_url,folder_id) VALUES ('feed','Feed','https://example.com/rss','removed');
      `);
      const response = await api.request(deletionRequest('removed'), {}, { DB: database.binding } as Env);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'FOLDER_DELETE_NAME_CONFLICT' } });
      expect(database.sqlite.prepare("SELECT parent_id FROM folders WHERE id='child'").get()?.parent_id).toBe('removed');
      expect(database.sqlite.prepare("SELECT folder_id FROM sources WHERE id='feed'").get()?.folder_id).toBe('removed');
      expect(database.sqlite.prepare("SELECT id FROM folders WHERE id='removed'").get()?.id).toBe('removed');
    } finally { database.sqlite.close(); }
  });

  it("rolls back prior moves when a later statement fails and retains an internal error", async () => {
    const database = sqliteD1();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      database.sqlite.exec(`
        INSERT INTO folders(id,name) VALUES ('removed','Removed');
        INSERT INTO folders(id,name,parent_id) VALUES ('child','Child','removed');
        INSERT INTO sources(id,title,normalized_url,folder_id) VALUES ('feed','Feed','https://example.com/rss','removed');
      `);
      database.state.beforeQuery = (sql) => { if (sql.startsWith('DELETE FROM folders')) throw new Error('simulated storage failure'); };
      const response = await api.request(deletionRequest('removed'), {}, { DB: database.binding } as Env);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(database.sqlite.prepare("SELECT parent_id FROM folders WHERE id='child'").get()?.parent_id).toBe('removed');
      expect(database.sqlite.prepare("SELECT folder_id FROM sources WHERE id='feed'").get()?.folder_id).toBe('removed');
      expect(database.sqlite.prepare("SELECT id FROM folders WHERE id='removed'").get()?.id).toBe('removed');
    } finally { log.mockRestore(); database.sqlite.close(); }
  });

  it("returns 404 when the folder has already been removed", async () => {
    const database = sqliteD1();
    try {
      const response = await api.request(deletionRequest('missing'), {}, { DB: database.binding } as Env);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'FOLDER_NOT_FOUND' } });
    } finally { database.sqlite.close(); }
  });
});
