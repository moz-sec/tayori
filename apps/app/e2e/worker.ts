import { api } from "../src/api";

const migrations = import.meta.glob<string>("../../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** This entrypoint is selected exclusively by vite.e2e.config.ts. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__e2e/reset") {
      if (
        url.hostname !== "127.0.0.1" ||
        request.method !== "POST" ||
        request.headers.get("Origin") !== url.origin
      ) {
        return new Response(null, { status: 403 });
      }
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      ).all<{ name: string }>();
      const dependencyOrder = [
        "board_articles",
        "fetch_jobs",
        "articles",
        "item_keys",
        "sources",
        "folders",
        "boards",
        "daily_usage",
        "app_state",
      ];
      for (const name of dependencyOrder) {
        if (tables.results.some((table) => table.name === name))
          await env.DB.exec(`DROP TABLE "${name}"`);
      }
      const unknown = tables.results.filter((table) => !dependencyOrder.includes(table.name));
      if (unknown.length)
        throw new Error(
          `Update the E2E reset dependency order for: ${unknown.map((table) => table.name).join(", ")}`,
        );
      for (const path of Object.keys(migrations).sort()) {
        const statements = migrations[path]
          .split(";")
          .map((sql) => sql.trim())
          .filter(Boolean);
        for (const sql of statements) await env.DB.prepare(sql).run();
      }
      await env.DB.exec("PRAGMA foreign_keys = ON");
      const now = Math.floor(Date.now() / 1000);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO folders (id, name, parent_id, sort_order) VALUES ('parent', '親フォルダ', NULL, 0), ('child', '子フォルダ', 'parent', 0), ('other', '移動先', NULL, 1)",
        ),
        env.DB.prepare(
          "INSERT INTO sources (id, normalized_url, folder_id, title, next_fetch_at) VALUES ('seed-source', 'https://example.com/seed.xml', 'child', 'テスト購読', ?)",
        ).bind(now + 3600),
      ]);
      const statements: D1PreparedStatement[] = [];
      for (let index = 1; index <= 55; index++) {
        const id = `article-${String(index).padStart(2, "0")}`;
        statements.push(
          env.DB.prepare(
            "INSERT INTO item_keys (id, source_id, key_hash, first_seen_at) VALUES (?, 'seed-source', ?, ?)",
          ).bind(id, id, now - index),
        );
        statements.push(
          env.DB.prepare(
            "INSERT INTO articles (id, title, url, summary_text, first_seen_at, expires_at) VALUES (?, ?, ?, 'ブラウザーテスト用の記事です', ?, ?)",
          ).bind(
            id,
            `テスト記事 ${String(index).padStart(2, "0")}`,
            `https://example.com/articles/${index}`,
            now - index,
            now + 604800,
          ),
        );
      }
      await env.DB.batch(statements);
      return Response.json({ ok: true });
    }
    return api.fetch(request, env, ctx);
  },
};
