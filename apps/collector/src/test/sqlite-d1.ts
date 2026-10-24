import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { URL } from "node:url";

/** Exercises production SQL against SQLite with D1 bind, query, and atomic-batch constraints. */
export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../../../migrations/0001_initial.sql", import.meta.url), "utf8"));
  const state = {
    queries: 0,
    maximumQueries: 0,
    maximumBinds: 0,
    beforeQuery: (_sql: string): void => {},
  };
  const meta = (changes = 0): D1Meta & Record<string, unknown> => ({
    changes, changed_db: changes > 0, duration: 0, last_row_id: 0,
    rows_read: 0, rows_written: changes, size_after: 0,
  });
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => {
    const execute = () => {
      state.queries++;
      state.maximumQueries = Math.max(state.maximumQueries, state.queries);
      state.maximumBinds = Math.max(state.maximumBinds, values.length);
      if (state.queries > 50) throw new Error("D1 query limit exceeded");
      if (values.length > 100) throw new Error("D1 bind limit exceeded");
      state.beforeQuery(sql);
      return sqlite.prepare(sql);
    };
    return {
      bind: (...parameters: unknown[]) => prepare(sql, parameters as SQLInputValue[]),
      first: async <T>(column?: string): Promise<T | null> => {
        const row = execute().get(...values);
        return (column ? row?.[column] : row) as T ?? null;
      },
      all: async <T>(): Promise<D1Result<T>> => ({
        success: true, results: execute().all(...values) as T[], meta: meta(),
      }),
      run: async <T>(): Promise<D1Result<T>> => ({
        success: true, results: [], meta: meta(Number(execute().run(...values).changes)),
      }),
    } as D1PreparedStatement;
  };
  const binding = {
    prepare,
    batch: async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run<T>());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as D1Database;
  return { sqlite, binding, state };
}
