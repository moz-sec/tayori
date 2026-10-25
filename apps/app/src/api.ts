import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { DEFAULT_RETENTION_DAYS, MAX_QUEUE_OPERATIONS_PER_DAY, normalizeFeedUrl } from "@tayori/shared";
import type { QueueMessage } from "@tayori/shared";
import { authenticate } from "./auth";
import { registerApiOperations } from "./api-docs";

type AppEnv = {
  Bindings: Env;
  Variables: { principal: string };
};

const FETCH_QUEUE_OPERATION_RESERVATION = 4;

type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  unread_count?: number;
};

type SourceRow = {
  id: string;
  folder_id: string | null;
  title: string;
  title_is_custom: number;
  site_url: string | null;
  normalized_url: string;
  status: "active" | "paused" | "archived";
  interval_minutes: number;
  next_fetch_at: number;
  generation: number;
  last_checked_at: number | null;
  last_success_at: number | null;
  last_error_code: string | null;
  consecutive_failures: number;
};

type ArticleRow = {
  id: string;
  source_id: string;
  source_title: string;
  title: string;
  url: string;
  author: string | null;
  summary_text: string | null;
  published_at: number | null;
  first_seen_at: number;
  expires_at: number;
  read_at: number | null;
  starred: number;
  read_later: number;
  saved_in_board: number;
  version: number;
};

class ApiError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413 | 415, readonly code: string) {
    super(code);
  }
}

export const api = new OpenAPIHono<AppEnv>().basePath("/api/v1");

// Every API route, including Swagger UI and the OpenAPI document, requires a valid Access JWT.
api.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth.ok) {
    return c.json({ error: { code: auth.code } }, auth.status);
  }
  c.set("principal", auth.principal);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.json({ error: { code: "ORIGIN_NOT_ALLOWED" } }, 403);
    }
    if (c.req.method !== "DELETE" && !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: { code: "JSON_REQUIRED" } }, 415);
    }
  }
  await next();
});

api.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code } }, error.status);
  }
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({
    event: "api_error",
    requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    name: error.name,
    message: error.message,
  }));
  return c.json({ error: { code: "INTERNAL_ERROR", requestId } }, 500);
});

api.get("/health", (c) => c.json({ data: { status: "ok" } }));

api.get("/me", (c) => c.json({ data: { email: c.get("principal"), retentionDays: DEFAULT_RETENTION_DAYS } }));

api.get("/folders", async (c) => {
  const now = unixNow();
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.parent_id, f.name, f.sort_order, f.created_at,
       (SELECT COUNT(*) FROM articles a JOIN item_keys k ON k.id = a.id
        JOIN sources s ON s.id = k.source_id
        WHERE s.folder_id IN (WITH RECURSIVE descendants(id) AS (
          SELECT f.id UNION ALL SELECT child.id FROM folders child JOIN descendants d ON child.parent_id=d.id
        ) SELECT id FROM descendants)
        AND a.read_at IS NULL AND (a.expires_at > ? OR a.starred = 1 OR a.read_later = 1 OR
          EXISTS (SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id))) AS unread_count
     FROM folders f ORDER BY f.sort_order, lower(f.name), f.id`,
  ).bind(now).all<FolderRow>();
  return c.json({ data: (results ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    unreadCount: row.unread_count ?? 0,
  })) });
});

api.post("/folders", async (c) => {
  const body = await readJson(c.req.raw);
  const name = readName(body.name);
  const parentId = nullableId(body.parentId);
  if (parentId) await requireRow(c.env.DB, "SELECT id FROM folders WHERE id = ?", parentId);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM folders WHERE COALESCE(parent_id, '') = COALESCE(?, '') AND lower(name) = lower(?) LIMIT 1",
  ).bind(parentId, name).first<{ id: string }>();
  if (existing) throw new ApiError(409, "FOLDER_ALREADY_EXISTS");
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO folders(id, parent_id, name) VALUES (?, ?, ?)")
    .bind(id, parentId, name).run();
  return c.json({ data: { id, parentId, name, sortOrder: 0 } }, 201);
});

api.patch("/folders/:id", async (c) => {
  const body = await readJson(c.req.raw);
  const id = c.req.param("id");
  const current = await requireRow(c.env.DB, "SELECT id, parent_id, name, sort_order FROM folders WHERE id = ?", id);
  const row = current as { id: string; parent_id: string | null; name: string; sort_order: number };
  const name = body.name === undefined ? row.name : readName(body.name);
  const parentId = body.parentId === undefined ? row.parent_id : nullableId(body.parentId);
  const sortOrder = body.sortOrder === undefined ? row.sort_order : readInteger(body.sortOrder, 0, 100_000);
  if (parentId) {
    await requireRow(c.env.DB, "SELECT id FROM folders WHERE id = ?", parentId);
    const cycle = await c.env.DB.prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM folders WHERE parent_id = ?
         UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
       ) SELECT id FROM descendants WHERE id = ? LIMIT 1`,
    ).bind(id, parentId).first<{ id: string }>();
    if (parentId === id || cycle) throw new ApiError(409, "FOLDER_CYCLE");
  }
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM folders WHERE id != ? AND COALESCE(parent_id, '') = COALESCE(?, '') AND lower(name) = lower(?) LIMIT 1",
  ).bind(id, parentId, name).first<{ id: string }>();
  if (conflict) throw new ApiError(409, "FOLDER_ALREADY_EXISTS");
  await c.env.DB.prepare("UPDATE folders SET parent_id = ?, name = ?, sort_order = ? WHERE id = ?")
    .bind(parentId, name, sortOrder, id).run();
  return c.json({ data: { id, parentId, name, sortOrder } });
});

api.delete("/folders/:id", async (c) => {
  const id = c.req.param("id");
  const folder = await c.env.DB.prepare("SELECT parent_id FROM folders WHERE id = ?")
    .bind(id).first<{ parent_id: string | null }>();
  if (!folder) throw new ApiError(404, "FOLDER_NOT_FOUND");
  const parentId = folder.parent_id;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE folders SET parent_id = ? WHERE parent_id = ?").bind(parentId, id),
    c.env.DB.prepare("UPDATE sources SET folder_id = ? WHERE folder_id = ?").bind(parentId, id),
    c.env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(id),
  ]);
  return c.body(null, 204);
});

api.get("/sources", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, folder_id, title, site_url, normalized_url, status, interval_minutes,
       next_fetch_at, last_checked_at, last_success_at, last_error_code, consecutive_failures
     FROM sources ORDER BY status, lower(title), id`,
  ).all<SourceRow>();
  return c.json({ data: (results ?? []).map(sourceDto) });
});

api.post("/sources", async (c) => {
  const body = await readJson(c.req.raw);
  const created = await createSource(c.env.DB, body);
  await enqueueInitialFetch(c.env.DB, c.env.JOBS, created.id, created.generation);
  return c.json({ data: sourceDto(created) }, 201);
});

api.post("/sources/import", async (c) => {
  const body = await readJson(c.req.raw);
  if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 5) {
    throw new ApiError(400, "IMPORT_BATCH_LIMIT");
  }
  const results: Array<{ status: "added" | "existing" | "error"; source?: ReturnType<typeof sourceDto>; code?: string }> = [];
  for (const input of body.sources) {
    try {
      const created = await createSource(c.env.DB, input);
      await enqueueInitialFetch(c.env.DB, c.env.JOBS, created.id, created.generation);
      results.push({ status: "added", source: sourceDto(created) });
    } catch (error) {
      if (error instanceof ApiError && error.code === "SOURCE_ALREADY_EXISTS") {
        const url = normalizeFeedUrl(String(asRecord(input).url ?? ""));
        const existing = await c.env.DB.prepare("SELECT * FROM sources WHERE normalized_url = ?")
          .bind(url).first<SourceRow>();
        results.push({ status: "existing", ...(existing ? { source: sourceDto(existing) } : {}) });
      } else {
        results.push({ status: "error", code: error instanceof ApiError ? error.code : "INVALID_SOURCE" });
      }
    }
  }
  return c.json({ data: results });
});

api.patch("/sources/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c.req.raw);
  const current = await c.env.DB.prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id).first<SourceRow>();
  if (!current) throw new ApiError(404, "SOURCE_NOT_FOUND");
  const folderId = body.folderId === undefined ? current.folder_id : nullableId(body.folderId);
  if (folderId) await requireRow(c.env.DB, "SELECT id FROM folders WHERE id = ?", folderId);
  const status = body.status === undefined ? current.status : readSourceStatus(body.status);
  if (status === "archived") throw new ApiError(400, "USE_ARCHIVE_ENDPOINT");
  const title = body.title === undefined ? current.title : readName(body.title);
  const titleIsCustom = body.title === undefined ? current.title_is_custom : 1;
  await c.env.DB.prepare(
    "UPDATE sources SET folder_id = ?, status = ?, title = ?, title_is_custom = ?, generation = generation + 1 WHERE id = ?",
  ).bind(folderId, status, title, titleIsCustom, id).run();
  const updated = await c.env.DB.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
  return c.json({ data: sourceDto(updated!) });
});

api.delete("/sources/:id", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE sources SET status = 'archived', generation = generation + 1 WHERE id = ? AND status != 'archived'",
  ).bind(c.req.param("id")).run();
  if (!result.meta.changes) {
    const exists = await c.env.DB.prepare("SELECT id FROM sources WHERE id = ?").bind(c.req.param("id")).first();
    if (!exists) throw new ApiError(404, "SOURCE_NOT_FOUND");
  }
  return c.body(null, 204);
});

api.get("/subscriptions.opml", async (c) => {
  const folders = (await c.env.DB.prepare("SELECT id, parent_id, name FROM folders ORDER BY sort_order, lower(name)")
    .all<{ id: string; parent_id: string | null; name: string }>()).results ?? [];
  const sources = (await c.env.DB.prepare(
    "SELECT id, folder_id, title, site_url, normalized_url FROM sources WHERE status != 'archived' ORDER BY lower(title)",
  ).all<{ id: string; folder_id: string | null; title: string; site_url: string | null; normalized_url: string }>()).results ?? [];
  const renderFolder = (parentId: string | null): string => {
    const childFolders = folders.filter((folder) => folder.parent_id === parentId);
    const childSources = sources.filter((source) => source.folder_id === parentId);
    const entries = childFolders.map((folder) =>
      `<outline text="${xmlEscape(folder.name)}" title="${xmlEscape(folder.name)}">${renderFolder(folder.id)}</outline>`,
    ).concat(childSources.map((source) =>
      `<outline type="rss" text="${xmlEscape(source.title)}" title="${xmlEscape(source.title)}" xmlUrl="${xmlEscape(source.normalized_url)}"${source.site_url ? ` htmlUrl="${xmlEscape(source.site_url)}"` : ""}/>`
    ));
    return entries.join("");
  };
  const opml = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Tayori subscriptions</title></head><body>${renderFolder(null)}</body></opml>`;
  return c.body(opml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Content-Disposition": "attachment; filename=\"tayori-subscriptions.opml\"",
  });
});

api.get("/articles", async (c) => {
  const scope = c.req.query("scope") ?? "all";
  if (!["all", "unread", "read-later", "starred"].includes(scope)) throw new ApiError(400, "INVALID_SCOPE");
  const sourceId = optionalId(c.req.query("sourceId"));
  const folderId = optionalId(c.req.query("folderId"));
  const boardId = optionalId(c.req.query("boardId"));
  const limit = c.req.query("limit") === undefined ? 50 : readInteger(Number(c.req.query("limit")), 1, 50);
  const cursor = c.req.query("cursor") ? decodeCursor(c.req.query("cursor")!) : null;
  const where = ["(a.expires_at > ? OR a.starred = 1 OR a.read_later = 1 OR EXISTS (SELECT 1 FROM board_articles ba WHERE ba.article_id=a.id))"];
  const values: Array<string | number | null> = [unixNow()];
  if (scope === "unread") where.push("a.read_at IS NULL");
  if (scope === "read-later") where.push("a.read_later = 1");
  if (scope === "starred") where.push("a.starred = 1");
  if (sourceId) { where.push("s.id = ?"); values.push(sourceId); }
  if (folderId) {
    where.push(`s.folder_id IN (WITH RECURSIVE descendants(id) AS (
      SELECT id FROM folders WHERE id = ? UNION ALL
      SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
    ) SELECT id FROM descendants)`);
    values.push(folderId);
  }
  if (boardId) { where.push("EXISTS (SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id AND ba.board_id = ?)"); values.push(boardId); }
  if (cursor) {
    where.push("(COALESCE(a.published_at, a.first_seen_at) < ? OR (COALESCE(a.published_at, a.first_seen_at) = ? AND a.id < ?))");
    values.push(cursor.at, cursor.at, cursor.id);
  }
  values.push(limit + 1);
  const result = await c.env.DB.prepare(
    `SELECT a.id, s.id AS source_id, s.title AS source_title, a.title, a.url, a.author,
       a.summary_text, a.published_at, a.first_seen_at, a.expires_at, a.read_at,
       a.starred, a.read_later,
       EXISTS(SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id) AS saved_in_board,
       a.version
     FROM articles a JOIN item_keys k ON k.id = a.id JOIN sources s ON s.id = k.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC, a.id DESC LIMIT ?`,
  ).bind(...values).all<ArticleRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return c.json({ data: page.map(articleDto), nextCursor: hasMore && last ? encodeCursor(last) : null });
});

api.get("/articles/:id", async (c) => {
  const row = await loadArticle(c.env.DB, c.req.param("id"));
  if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND");
  return c.json({ data: articleDto(row) });
});

api.patch("/articles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c.req.raw);
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  if (body.read !== undefined) {
    if (typeof body.read !== "boolean") throw new ApiError(400, "INVALID_READ_STATE");
    fields.push("read_at = ?"); values.push(body.read ? unixNow() : null);
  }
  if (body.starred !== undefined) {
    if (typeof body.starred !== "boolean") throw new ApiError(400, "INVALID_STAR_STATE");
    fields.push("starred = ?"); values.push(Number(body.starred));
  }
  if (body.readLater !== undefined) {
    if (typeof body.readLater !== "boolean") throw new ApiError(400, "INVALID_SAVE_STATE");
    fields.push("read_later = ?"); values.push(Number(body.readLater));
  }
  if (!fields.length) throw new ApiError(400, "NO_ARTICLE_CHANGES");
  const expectedVersion = body.expectedVersion === undefined ? null : readInteger(body.expectedVersion, 1, 2_147_483_647);
  values.push(id);
  let versionFilter = "";
  if (expectedVersion !== null) { versionFilter = " AND version = ?"; values.push(expectedVersion); }
  const update = await c.env.DB.prepare(
    `UPDATE articles SET ${fields.join(", ")}, version = version + 1, updated_at = unixepoch()
     WHERE id = ?${versionFilter}`,
  ).bind(...values).run();
  if (!update.meta.changes) {
    const exists = await loadArticle(c.env.DB, id);
    if (!exists) throw new ApiError(404, "ARTICLE_NOT_FOUND");
    throw new ApiError(409, "VERSION_CONFLICT");
  }
  const row = await loadArticle(c.env.DB, id);
  return c.json({ data: articleDto(row!) });
});

api.post("/articles/read", async (c) => {
  const body = await readJson(c.req.raw);
  if (!Array.isArray(body.articleIds) || body.articleIds.length > 50 || typeof body.read !== "boolean") {
    throw new ApiError(400, "INVALID_BULK_READ");
  }
  const ids = [...new Set(body.articleIds.map((id) => readId(id)))];
  const at = body.read ? unixNow() : null;
  const results = await c.env.DB.batch(ids.map((id) => c.env.DB.prepare(
    "UPDATE articles SET read_at = ?, version = version + 1, updated_at = unixepoch() WHERE id = ?",
  ).bind(at, id)));
  return c.json({ data: { updated: results.reduce((total, result) => total + result.meta.changes, 0), requested: ids.length } });
});

api.get("/boards", async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT b.id, b.name, b.sort_order, COUNT(ba.article_id) AS article_count
     FROM boards b LEFT JOIN board_articles ba ON ba.board_id = b.id
     GROUP BY b.id ORDER BY b.sort_order, lower(b.name)`,
  ).all<{ id: string; name: string; sort_order: number; article_count: number }>()).results ?? [];
  return c.json({ data: rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order, articleCount: row.article_count })) });
});

api.post("/boards", async (c) => {
  const name = readName((await readJson(c.req.raw)).name);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare("INSERT INTO boards(id, name) VALUES (?, ?)").bind(id, name).run();
  } catch {
    throw new ApiError(409, "BOARD_ALREADY_EXISTS");
  }
  return c.json({ data: { id, name, sortOrder: 0, articleCount: 0 } }, 201);
});

api.patch("/boards/:id", async (c) => {
  const body = await readJson(c.req.raw);
  const name = body.name === undefined ? null : readName(body.name);
  const sortOrder = body.sortOrder === undefined ? null : readInteger(body.sortOrder, 0, 100_000);
  if (name === null && sortOrder === null) throw new ApiError(400, "NO_BOARD_CHANGES");
  const current = await c.env.DB.prepare("SELECT name, sort_order FROM boards WHERE id = ?")
    .bind(c.req.param("id")).first<{ name: string; sort_order: number }>();
  if (!current) throw new ApiError(404, "BOARD_NOT_FOUND");
  try {
    await c.env.DB.prepare("UPDATE boards SET name = ?, sort_order = ? WHERE id = ?")
      .bind(name ?? current.name, sortOrder ?? current.sort_order, c.req.param("id")).run();
  } catch {
    throw new ApiError(409, "BOARD_ALREADY_EXISTS");
  }
  return c.json({ data: { id: c.req.param("id"), name: name ?? current.name, sortOrder: sortOrder ?? current.sort_order } });
});

api.delete("/boards/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(c.req.param("id")).run();
  if (!result.meta.changes) throw new ApiError(404, "BOARD_NOT_FOUND");
  return c.body(null, 204);
});

api.put("/boards/:id/articles/:articleId", async (c) => {
  const boardId = c.req.param("id");
  const articleId = c.req.param("articleId");
  await requireRow(c.env.DB, "SELECT id FROM boards WHERE id = ?", boardId, "BOARD_NOT_FOUND");
  const result = await c.env.DB.prepare(
    `INSERT INTO board_articles(board_id, article_id)
     SELECT ?, id FROM articles WHERE id = ? ON CONFLICT(board_id, article_id) DO NOTHING`,
  ).bind(boardId, articleId).run();
  if (!result.meta.changes) {
    const exists = await c.env.DB.prepare("SELECT id FROM articles WHERE id = ?").bind(articleId).first();
    if (!exists) throw new ApiError(404, "ARTICLE_NOT_FOUND");
  }
  return c.body(null, 204);
});

api.delete("/boards/:id/articles/:articleId", async (c) => {
  await c.env.DB.prepare("DELETE FROM board_articles WHERE board_id = ? AND article_id = ?")
    .bind(c.req.param("id"), c.req.param("articleId")).run();
  return c.body(null, 204);
});

api.get("/status", async (c) => {
  const [tick, failures, active] = await Promise.all([
    c.env.DB.prepare("SELECT value FROM app_state WHERE key = 'last_tick'").first<{ value: string }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM sources WHERE status = 'active' AND consecutive_failures > 0").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM sources WHERE status = 'active'").first<{ count: number }>(),
  ]);
  return c.json({ data: { lastTickAt: tick ? new Date(Number(tick.value) * 1000).toISOString() : null, activeSources: active?.count ?? 0, failingSources: failures?.count ?? 0 } });
});

registerApiOperations(api.openAPIRegistry);

api.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Tayori API",
    version: "1.0.0",
    description:
      "Tayori の記事・購読先・フォルダ・ボードAPIです。" +
      "全エンドポイントでCloudflare Access認証が必要です。JSON時刻はISO 8601 UTCです。",
  },
  servers: [{ url: "/api/v1" }],
});

api.get("/docs", swaggerUI({ url: "/api/v1/openapi.json" }));

async function createSource(db: D1Database, input: unknown): Promise<SourceRow> {
  const body = asRecord(input);
  if (typeof body.url !== "string" || body.url.length > 2048) throw new ApiError(400, "INVALID_FEED_URL");
  let url: string;
  try { url = normalizeFeedUrl(body.url); } catch { throw new ApiError(400, "INVALID_FEED_URL"); }
  const folderId = body.folderId === undefined ? null : nullableId(body.folderId);
  if (folderId) await requireRow(db, "SELECT id FROM folders WHERE id = ?", folderId);
  const title = body.title === undefined || body.title === "" ? new URL(url).hostname : readName(body.title);
  const titleIsCustom = body.title === undefined || body.title === "" ? 0 : 1;
  const siteUrl = body.siteUrl === undefined ? null : readOptionalHttpUrl(body.siteUrl);
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO sources(id, kind, normalized_url, folder_id, title, title_is_custom, site_url, status, interval_minutes, next_fetch_at) VALUES (?, 'rss', ?, ?, ?, ?, ?, 'active', 60, unixepoch())",
    ).bind(id, url, folderId, title, titleIsCustom, siteUrl).run();
  } catch (error) {
    if (isNormalizedUrlConflict(error)) throw new ApiError(409, "SOURCE_ALREADY_EXISTS");
    throw error;
  }
  const result = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
  return result!;
}

/** Persists an initial fetch job before sending it so the hourly tick can recover a failed send. */
async function enqueueInitialFetch(
  db: D1Database,
  jobs: Queue<QueueMessage>,
  sourceId: string,
  generation: number,
): Promise<void> {
  const now = unixNow();
  const jobId = crypto.randomUUID();
  try {
    const inserted = await db.prepare(
      `INSERT INTO fetch_jobs(id, source_id, generation, status, created_at)
       SELECT ?, id, generation, 'pending', ? FROM sources
       WHERE id = ? AND status = 'active' AND generation = ?
         AND NOT EXISTS (
           SELECT 1 FROM fetch_jobs j WHERE j.source_id = sources.id
             AND j.status IN ('pending', 'sent', 'running')
         )
       ON CONFLICT DO NOTHING`,
    ).bind(jobId, now, sourceId, generation).run();
    if (!inserted.meta.changes || !await reserveQueueOperation(db, now)) return;

    await jobs.send({ schemaVersion: 1, type: "fetch", jobId });
    await db.prepare("UPDATE fetch_jobs SET status = 'sent', lease_until = ? WHERE id = ? AND status = 'pending'")
      .bind(now + 3_600, jobId).run();
  } catch (error) {
    // The source remains due for the hourly Collector tick even if initial queueing fails.
    console.error(JSON.stringify({
      event: "initial_feed_fetch_enqueue_failed",
      sourceId,
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "Unknown error",
    }));
  }
}

/** Reserves the shared daily Queue-operation budget before an initial job is sent. */
async function reserveQueueOperation(db: D1Database, now: number): Promise<boolean> {
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const row = await db.prepare(
    `INSERT INTO daily_usage(day_utc, reserved_queue_ops) VALUES (?, ?)
     ON CONFLICT(day_utc) DO UPDATE SET reserved_queue_ops = daily_usage.reserved_queue_ops + excluded.reserved_queue_ops
     WHERE daily_usage.reserved_queue_ops + excluded.reserved_queue_ops <= ?
     RETURNING day_utc`,
  ).bind(day, FETCH_QUEUE_OPERATION_RESERVATION, MAX_QUEUE_OPERATIONS_PER_DAY).first<{ day_utc: string }>();
  return row !== null;
}

function isNormalizedUrlConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/UNIQUE constraint failed:\s*sources\.normalized_url/i.test(error.message)) return true;
  return isNormalizedUrlConflict(error.cause);
}

async function loadArticle(db: D1Database, id: string): Promise<ArticleRow | null> {
  return await db.prepare(
    `SELECT a.id, s.id AS source_id, s.title AS source_title, a.title, a.url, a.author,
       a.summary_text, a.published_at, a.first_seen_at, a.expires_at, a.read_at,
       a.starred, a.read_later,
       EXISTS(SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id) AS saved_in_board,
       a.version
     FROM articles a JOIN item_keys k ON k.id = a.id JOIN sources s ON s.id = k.source_id
     WHERE a.id = ? AND (a.expires_at > ? OR a.starred = 1 OR a.read_later = 1 OR
       EXISTS(SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id))`,
  ).bind(id, unixNow()).first<ArticleRow>();
}

function articleDto(row: ArticleRow) {
  const saved = Boolean(row.read_later || row.starred || row.saved_in_board);
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary_text,
    publishedAt: row.published_at ? new Date(row.published_at * 1000).toISOString() : null,
    firstSeenAt: new Date(row.first_seen_at * 1000).toISOString(),
    expiresAt: new Date(row.expires_at * 1000).toISOString(),
    read: row.read_at !== null,
    readAt: row.read_at ? new Date(row.read_at * 1000).toISOString() : null,
    starred: Boolean(row.starred),
    readLater: Boolean(row.read_later),
    saved,
    version: row.version,
  };
}

function sourceDto(row: SourceRow) {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    siteUrl: row.site_url,
    url: row.normalized_url,
    status: row.status,
    intervalMinutes: row.interval_minutes,
    nextFetchAt: new Date(row.next_fetch_at * 1000).toISOString(),
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at * 1000).toISOString() : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at * 1000).toISOString() : null,
    errorCode: row.last_error_code,
    consecutiveFailures: row.consecutive_failures,
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) throw new ApiError(413, "REQUEST_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32_768) {
      await reader.cancel();
      throw new ApiError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return asRecord(parsed);
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_NAME");
  const name = value.trim();
  if (!name || [...name].length > 100) throw new ApiError(400, "INVALID_NAME");
  return name;
}

function readOptionalHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new ApiError(400, "INVALID_SITE_URL");
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    throw new ApiError(400, "INVALID_SITE_URL");
  }
}

function readInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, "INVALID_INTEGER");
  }
  return value;
}

function readId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,100}$/.test(value)) throw new ApiError(400, "INVALID_ID");
  return value;
}

function nullableId(value: unknown): string | null {
  return value === null || value === "" ? null : readId(value);
}

function optionalId(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : readId(value);
}

function readSourceStatus(value: unknown): "active" | "paused" {
  if (value !== "active" && value !== "paused") throw new ApiError(400, "INVALID_SOURCE_STATUS");
  return value;
}

async function requireRow(db: D1Database, sql: string, value: string, notFoundCode = "NOT_FOUND"): Promise<unknown> {
  const row = await db.prepare(sql).bind(value).first();
  if (!row) throw new ApiError(404, notFoundCode);
  return row;
}

function unixNow(): number { return Math.floor(Date.now() / 1000); }

function encodeCursor(row: ArticleRow): string {
  const payload = JSON.stringify({ at: row.published_at ?? row.first_seen_at, id: row.id });
  return btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string): { at: number; id: string } {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError(400, "INVALID_CURSOR");
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const payload = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
    return { at: readInteger(payload.at, 0, 4_102_444_800), id: readId(payload.id) };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR");
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
