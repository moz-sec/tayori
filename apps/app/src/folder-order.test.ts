import { describe, expect, it } from "vitest";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

function move(db: D1Database, id: string, direction: string) {
  return api.request(
    `http://localhost/api/v1/folders/${id}/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ direction }),
    },
    { DB: db } as Env,
  );
}

describe("atomic folder ordering", () => {
  it("handles equal ranks, boundaries and parent groups without changing ancestry", async () => {
    const db = sqliteD1();
    try {
      db.sqlite
        .exec(`INSERT INTO folders(id, name, sort_order) VALUES ('a', 'A', 0), ('b', 'B', 0), ('c', 'C', 0);
        INSERT INTO folders(id, name, parent_id, sort_order) VALUES ('x', 'X', 'a', 0), ('y', 'Y', 'a', 0);`);
      const ordered = (parent: string | null) =>
        db.sqlite
          .prepare(
            "SELECT id FROM folders WHERE parent_id IS ? ORDER BY sort_order, lower(name), id",
          )
          .all(parent)
          .map((row) => row.id);
      expect((await move(db.binding, "b", "up")).status).toBe(204);
      expect(ordered(null)).toEqual(["b", "a", "c"]);
      expect(ordered("a")).toEqual(["x", "y"]);
      expect((await move(db.binding, "b", "up")).status).toBe(204);
      expect(ordered(null)).toEqual(["b", "a", "c"]);
      expect((await move(db.binding, "b", "down")).status).toBe(204);
      expect(ordered(null)).toEqual(["a", "b", "c"]);
      expect((await move(db.binding, "x", "down")).status).toBe(204);
      expect(ordered("a")).toEqual(["y", "x"]);
      expect(ordered(null)).toEqual(["a", "b", "c"]);
      expect((await move(db.binding, "x", "down")).status).toBe(204);
      expect(ordered("a")).toEqual(["y", "x"]);
      expect(
        db.sqlite.prepare("SELECT parent_id FROM folders WHERE id = 'x'").get()?.parent_id,
      ).toBe("a");
    } finally {
      db.sqlite.close();
    }
  });
  it("rolls back all ranks if a row update fails", async () => {
    const db = sqliteD1();
    try {
      db.sqlite
        .exec(`INSERT INTO folders(id, name, sort_order) VALUES ('a', 'A', 0), ('b', 'B', 0), ('c', 'C', 0);
        CREATE TRIGGER reject_reorder BEFORE UPDATE OF sort_order ON folders
        WHEN NEW.id = 'b' AND NEW.sort_order != OLD.sort_order
        BEGIN SELECT RAISE(ABORT, 'reject reorder'); END;`);
      expect((await move(db.binding, "c", "up")).status).toBe(500);
      expect(
        db.sqlite
          .prepare("SELECT sort_order FROM folders ORDER BY id")
          .all()
          .map((row) => row.sort_order),
      ).toEqual([0, 0, 0]);
    } finally {
      db.sqlite.close();
    }
  });
  it("does not modify any siblings for a missing folder or invalid direction", async () => {
    const db = sqliteD1();
    try {
      db.sqlite.exec("INSERT INTO folders(id, name, sort_order) VALUES ('a', 'A', 42)");
      expect((await move(db.binding, "missing", "up")).status).toBe(404);
      expect((await move(db.binding, "a", "sideways")).status).toBe(400);
      expect(
        db.sqlite.prepare("SELECT sort_order FROM folders WHERE id = 'a'").get()?.sort_order,
      ).toBe(42);
    } finally {
      db.sqlite.close();
    }
  });
});
