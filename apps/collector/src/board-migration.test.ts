import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

describe("board removal migration", () => {
  it("removes board tables while preserving article state and identifiers", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(db.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    const migration = (name: string) =>
      readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");
    db.exec(migration("0001_initial.sql"));
    db.exec(migration("0002_collection_schedule.sql"));
    db.exec(`
      INSERT INTO sources(id, title, normalized_url) VALUES ('source', 'Source', 'https://example.com');
      INSERT INTO item_keys(id, source_id, key_hash, first_seen_at) VALUES ('a', 'source', 'hash', 1);
      INSERT INTO articles(id, title, url, first_seen_at, expires_at, read_at, starred, read_later)
      VALUES ('a', 'Article', 'https://example.com/a', 1, 2, 3, 1, 1);
      INSERT INTO boards(id, name) VALUES ('board', 'Board');
      INSERT INTO board_articles(board_id, article_id) VALUES ('board', 'a');
    `);
    db.exec(migration("0004_remove_boards.sql"));
    expect(
      db.prepare("SELECT read_at, starred, read_later FROM articles WHERE id = 'a'").get(),
    ).toMatchObject({ read_at: 3, starred: 1, read_later: 1 });
    expect(db.prepare("SELECT id FROM item_keys WHERE id = 'a'").get()).toBeTruthy();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('boards', 'board_articles')",
        )
        .all(),
    ).toHaveLength(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.close();
  });
});
