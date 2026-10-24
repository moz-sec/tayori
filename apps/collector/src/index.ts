import type { QueueMessage } from "@tayori/shared";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_ARTICLES_PER_FEED,
  MAX_FEED_RESPONSE_BYTES,
  MAX_QUEUE_OPERATIONS_PER_DAY,
} from "@tayori/shared";
import { FeedParseError, parseFeed, sha256, isSafeFeedTarget } from "./feed";

const JOB_LEASE_SECONDS = 300;
const HOUR_SECONDS = 3_600;
const JOB_DELIVERY_SECONDS = HOUR_SECONDS;
const TICK_RESERVATION = 4;
const FETCH_RESERVATION = 4;
// Recovery and new-job dispatch use separate pages to stay within 50 D1 queries.
const FETCH_BATCH_LIMIT = 10;

interface SourceRow {
  id: string;
  normalized_url: string;
  title: string;
  title_is_custom: number;
  interval_minutes: number;
  etag: string | null;
  last_modified: string | null;
  generation: number;
  status: "active" | "paused" | "archived";
  consecutive_failures: number;
}

interface JobRow {
  id: string;
  source_id: string;
  generation: number;
  status: string;
}

export default {
  async scheduled(controller, env): Promise<void> {
    const message: QueueMessage = {
      schemaVersion: 1,
      type: "tick",
      scheduledAt: controller.scheduledTime,
    };
    await env.JOBS.send(message);
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const value: unknown = message.body;
      if (!isQueueMessage(value)) {
        throw new Error("Invalid queue message");
      }
      if (value.type === "tick") {
        await processTick(env, value.scheduledAt, value.cursor);
      } else {
        await processFetch(env, value.jobId, message.attempts > 1);
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;

function isQueueMessage(value: unknown): value is QueueMessage {
  if (value === null || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.schemaVersion === 1 &&
    ((message.type === "tick" && Number.isSafeInteger(message.scheduledAt) && Number(message.scheduledAt) >= 0 &&
      (message.cursor === undefined || (typeof message.cursor === "string" && message.cursor.length <= 100))) ||
      (message.type === "fetch" && typeof message.jobId === "string" && message.jobId.length <= 100));
}

/** Dispatches one page of the hourly round and repairs unfinished jobs. */
async function processTick(env: Env, scheduledAtMs: number, cursor?: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const roundAt = Math.floor(scheduledAtMs / 1000 / HOUR_SECONDS) * HOUR_SECONDS;
  // An expired round must not overwrite the schedule of a more recent one.
  if (roundAt !== Math.floor(now / HOUR_SECONDS) * HOUR_SECONDS) return;
  if (cursor === undefined && !await reserveQueueOperations(env.DB, TICK_RESERVATION, now)) return;

  if (cursor === undefined) await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_state(key, value) VALUES ('last_tick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(String(now)),
    env.DB.prepare(
      `UPDATE fetch_jobs SET status = 'pending', lease_until = NULL
       WHERE (status = 'running' AND lease_until <= ?)
          OR (status = 'sent' AND COALESCE(lease_until, created_at + ?) <= ?)`,
    ).bind(now, JOB_DELIVERY_SECONDS, now),
    env.DB.prepare(
      `DELETE FROM fetch_jobs WHERE id IN (
         SELECT id FROM fetch_jobs WHERE status IN ('done','failed') AND completed_at <= ?
         ORDER BY completed_at, id LIMIT 1000
       )`,
    ).bind(now - DEFAULT_RETENTION_DAYS * 86_400),
  ]);
  if (cursor === undefined) await purgeExpiredArticles(env.DB, now);

  const pending = (await env.DB.prepare(
    "SELECT id, source_id, generation, status FROM fetch_jobs WHERE status = 'pending' ORDER BY created_at LIMIT ?",
  ).bind(FETCH_BATCH_LIMIT).all<JobRow>()).results ?? [];
  for (const job of pending) {
    if (!await reserveQueueOperations(env.DB, FETCH_RESERVATION, now)) return;
    await env.JOBS.send({ schemaVersion: 1, type: "fetch", jobId: job.id });
    await markJobSent(env.DB, job.id, now);
  }
  if (pending.length) {
    await continueTick(env, roundAt, cursor ?? "", now);
    return;
  }

  const due = (await env.DB.prepare(
    `SELECT id, normalized_url, title, interval_minutes, etag, last_modified, generation, status, consecutive_failures
     FROM sources WHERE status = 'active' AND next_fetch_at <= ? AND id > ?
       AND NOT EXISTS (SELECT 1 FROM fetch_jobs j WHERE j.source_id = sources.id AND j.status IN ('pending','sent','running'))
     ORDER BY id LIMIT ?`,
  ).bind(roundAt, cursor ?? "", FETCH_BATCH_LIMIT).all<SourceRow>()).results ?? [];

  for (const source of due) {
    if (!await reserveQueueOperations(env.DB, FETCH_RESERVATION, now)) return;
    const jobId = crypto.randomUUID();
    const nextFetchAt = roundAt + HOUR_SECONDS;
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO fetch_jobs(id, source_id, generation, status, created_at)
         SELECT ?, id, generation, 'pending', ? FROM sources
         WHERE id = ? AND status = 'active' AND generation = ? AND next_fetch_at <= ?
           AND NOT EXISTS (SELECT 1 FROM fetch_jobs j WHERE j.source_id = sources.id AND j.status IN ('pending','sent','running'))
         ON CONFLICT(id) DO NOTHING`,
      ).bind(jobId, now, source.id, source.generation, roundAt),
      env.DB.prepare(
        `UPDATE sources SET next_fetch_at = ? WHERE id = ? AND status = 'active' AND generation = ?
         AND next_fetch_at <= ? AND EXISTS (SELECT 1 FROM fetch_jobs WHERE id = ? AND status = 'pending')`,
      ).bind(nextFetchAt, source.id, source.generation, roundAt, jobId),
    ]);
    if (!results[0]?.meta.changes) continue;
    await env.JOBS.send({ schemaVersion: 1, type: "fetch", jobId });
    await markJobSent(env.DB, jobId, now);
  }

  if (due.length === FETCH_BATCH_LIMIT) await continueTick(env, roundAt, due.at(-1)!.id, now);
}

/** Reserves the delivery budget before sending the next page of this round. */
async function continueTick(env: Env, roundAt: number, cursor: string, now: number): Promise<void> {
  if (!await reserveQueueOperations(env.DB, TICK_RESERVATION, now)) return;
  await env.JOBS.send({ schemaVersion: 1, type: "tick", scheduledAt: roundAt * 1000, cursor });
}

/** Records a delivery deadline so lost Queue messages can be sent again. */
async function markJobSent(db: D1Database, jobId: string, now: number): Promise<void> {
  await db.prepare("UPDATE fetch_jobs SET status = 'sent', lease_until = ? WHERE id = ? AND status = 'pending'")
    .bind(now + JOB_DELIVERY_SECONDS, jobId).run();
}

/** Aligns successful polling to the next hourly Cron boundary. */
function nextHourlyFetch(now: number): number {
  return (Math.floor(now / HOUR_SECONDS) + 1) * HOUR_SECONDS;
}

async function processFetch(env: Env, jobId: string, allowRunningRetry: boolean): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const job = await env.DB.prepare(
    `UPDATE fetch_jobs SET status = 'running', lease_until = ?, attempts = attempts + 1
     WHERE id = ? AND (status IN ('pending','sent') OR
       (status = 'running' AND (lease_until <= ? OR ? = 1)))
     RETURNING id, source_id, generation, status`,
  ).bind(now + JOB_LEASE_SECONDS, jobId, now, Number(allowRunningRetry)).first<JobRow>();
  if (!job) return;

  const source = await env.DB.prepare("SELECT * FROM sources WHERE id = ?")
    .bind(job.source_id).first<SourceRow>();
  if (!source || source.status !== "active" || source.generation !== job.generation) {
    await completeJob(env.DB, job.id, "done", now);
    return;
  }

  try {
    const response = await fetchWithRedirects(source);
    if (response.status === 304) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE sources SET last_checked_at = ?, last_success_at = ?, next_fetch_at = ?,
             consecutive_failures = 0, last_error_code = NULL, last_error_at = NULL
           WHERE id = ? AND generation = ?`,
        ).bind(now, now, nextHourlyFetch(now), source.id, job.generation),
        env.DB.prepare("UPDATE fetch_jobs SET status = 'done', lease_until = NULL, completed_at = ? WHERE id = ?")
          .bind(now, job.id),
      ]);
      return;
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfterSeconds(retryAfter, now);
      throw new FeedFetchError(`http_${response.status}`, seconds);
    }

    const xml = await readLimitedText(response);
    const parsed = await parseFeed(xml, source.normalized_url);
    if (parsed.articles.length > MAX_ARTICLES_PER_FEED) throw new FeedParseError("Feed contains too many entries.");
    await storeArticles(env.DB, source, parsed.articles, now, job.generation);
    const siteUrl = readSiteUrl(xml, source.normalized_url);
    const newEtag = response.headers.get("etag");
    const newLastModified = response.headers.get("last-modified");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sources SET title = CASE WHEN title_is_custom = 0 AND ? != '' THEN ? ELSE title END,
           site_url = COALESCE(?, site_url), etag = ?, last_modified = ?, last_checked_at = ?,
           last_success_at = ?, next_fetch_at = ?, consecutive_failures = 0,
           last_error_code = NULL, last_error_at = NULL
         WHERE id = ? AND generation = ?`,
      ).bind(parsed.title ?? "", parsed.title ?? "", siteUrl, newEtag, newLastModified, now, now,
        nextHourlyFetch(now), source.id, job.generation),
      env.DB.prepare("UPDATE fetch_jobs SET status = 'done', lease_until = NULL, completed_at = ? WHERE id = ?")
        .bind(now, job.id),
    ]);
  } catch (error) {
    if (error instanceof FeedFetchError || error instanceof FeedParseError || error instanceof RangeError) {
      const code = error instanceof FeedFetchError ? error.code : "invalid_feed";
      const retryAfter = error instanceof FeedFetchError ? error.retryAfterSeconds : null;
      const failures = source.consecutive_failures + 1;
      const fallback = Math.min(24 * 60 * 60, [15 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60][Math.min(failures - 1, 3)]!);
      const nextFetch = Math.max(now + fallback, retryAfter ? now + retryAfter : 0);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE sources SET last_checked_at = ?, next_fetch_at = ?, consecutive_failures = ?,
             last_error_code = ?, last_error_at = ? WHERE id = ? AND generation = ?`,
        ).bind(now, nextFetch, failures, code, now, source.id, job.generation),
        env.DB.prepare("UPDATE fetch_jobs SET status = 'failed', lease_until = NULL, completed_at = ? WHERE id = ?")
          .bind(now, job.id),
      ]);
      return;
    }
    throw error;
  }
}

class FeedFetchError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds: number | null = null) {
    super(code);
  }
}

async function fetchWithRedirects(source: SourceRow): Promise<Response> {
  let current = source.normalized_url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isSafeFeedTarget(current)) throw new FeedFetchError("unsafe_feed_url");
    const headers = new Headers({
      Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      "User-Agent": "Tayori/0.1 (+personal RSS reader)",
    });
    if (source.etag) headers.set("If-None-Match", source.etag);
    if (source.last_modified) headers.set("If-Modified-Since", source.last_modified);
    const response = await fetch(current, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new FeedFetchError("redirect_limit");
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new FeedFetchError("redirect_limit");
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  const maximum = MAX_FEED_RESPONSE_BYTES;
  if (declaredLength > maximum) throw new RangeError("Feed response too large");
  if (!response.body) throw new FeedParseError("Feed response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new RangeError("Feed response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

/** Inserts new entries and updates changed content while preserving reading state and retention. */
async function storeArticles(
  db: D1Database,
  source: SourceRow,
  articles: Awaited<ReturnType<typeof parseFeed>>["articles"],
  now: number,
  generation: number,
): Promise<void> {
  const incoming = new Map<string, Awaited<ReturnType<typeof parseFeed>>["articles"][number]>();
  for (const article of articles) {
    const keyHash = await sha256(`${source.id}\0${article.keyKind}\0${article.keyValue}`);
    if (!incoming.has(keyHash)) incoming.set(keyHash, article);
  }
  const hashes = [...incoming.keys()];
  for (let offset = 0; offset < hashes.length; offset += 80) {
    const chunk = hashes.slice(offset, offset + 80);
    const known = (await db.prepare(
      `SELECT k.key_hash, a.id AS article_id, a.content_hash
       FROM item_keys k LEFT JOIN articles a ON a.id = k.id
       WHERE k.source_id = ? AND k.key_hash IN (${chunk.map(() => "?").join(",")})`,
    ).bind(source.id, ...chunk).all<{ key_hash: string; article_id: string | null; content_hash: string | null }>()).results;
    for (const row of known) {
      // Keep expired keys as tombstones, even when the feed's content has changed.
      if (row.article_id === null || row.content_hash === incoming.get(row.key_hash)?.contentHash) {
        incoming.delete(row.key_hash);
      }
    }
  }

  // Ten entries use <=76 binds per statement and <=47 D1 queries for a 200-entry feed.
  const changed = [...incoming.entries()];
  for (let offset = 0; offset < changed.length; offset += 10) {
    const chunk = changed.slice(offset, offset + 10);
    await db.batch([
      db.prepare(
        `WITH incoming(id) AS (VALUES ${chunk.map(() => "(?)").join(",")})
         INSERT INTO item_keys(id, source_id, key_hash, first_seen_at)
         SELECT id, ?, id, ? FROM incoming
         WHERE EXISTS (SELECT 1 FROM sources WHERE id = ? AND generation = ? AND status = 'active')
         ON CONFLICT(source_id, key_hash) DO NOTHING`,
      ).bind(...chunk.map(([hash]) => hash), source.id, now, source.id, generation),
      db.prepare(
        `WITH incoming(id, title, url, author, summary_text, published_at, content_hash)
           AS (VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",")})
         INSERT INTO articles(id, title, url, author, summary_text, published_at, content_hash,
           first_seen_at, expires_at, updated_at)
         SELECT i.id, i.title, i.url, i.author, i.summary_text, i.published_at, i.content_hash,
           k.first_seen_at, k.first_seen_at + ?, ?
         FROM incoming i JOIN item_keys k ON k.id = i.id
         WHERE k.source_id = ? AND (k.first_seen_at = ? OR EXISTS (SELECT 1 FROM articles a WHERE a.id = i.id))
           AND EXISTS (SELECT 1 FROM sources WHERE id = ? AND generation = ? AND status = 'active')
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, url = excluded.url, author = excluded.author,
           summary_text = excluded.summary_text, published_at = excluded.published_at,
           content_hash = excluded.content_hash, updated_at = excluded.updated_at,
           version = articles.version + 1
         WHERE articles.content_hash IS NOT excluded.content_hash`,
      ).bind(...chunk.flatMap(([hash, article]) => [hash, article.title, article.url, article.author,
        article.summary, article.publishedAt, article.contentHash]),
        DEFAULT_RETENTION_DAYS * 86_400, now, source.id, now, source.id, generation),
    ]);
  }
}

async function reserveQueueOperations(db: D1Database, count: number, now: number): Promise<boolean> {
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const row = await db.prepare(
    `INSERT INTO daily_usage(day_utc, reserved_queue_ops) VALUES (?, ?)
     ON CONFLICT(day_utc) DO UPDATE SET reserved_queue_ops = daily_usage.reserved_queue_ops + excluded.reserved_queue_ops
     WHERE daily_usage.reserved_queue_ops + excluded.reserved_queue_ops <= ?
     RETURNING day_utc`,
  ).bind(day, count, MAX_QUEUE_OPERATIONS_PER_DAY).first<{ day_utc: string }>();
  return row !== null;
}

async function purgeExpiredArticles(db: D1Database, now: number): Promise<void> {
  await db.prepare(
    `DELETE FROM articles WHERE id IN (
      SELECT a.id FROM articles a WHERE a.expires_at <= ? AND a.starred = 0 AND a.read_later = 0
        AND NOT EXISTS (SELECT 1 FROM board_articles ba WHERE ba.article_id = a.id)
      ORDER BY a.expires_at, a.id LIMIT 100
    )`,
  ).bind(now).run();
}

async function completeJob(db: D1Database, id: string, status: "done" | "failed", now: number): Promise<void> {
  await db.prepare("UPDATE fetch_jobs SET status = ?, lease_until = NULL, completed_at = ? WHERE id = ?")
    .bind(status, now, id).run();
}

function retryAfterSeconds(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(86_400, Math.floor(seconds)));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(86_400, Math.ceil(timestamp / 1000 - now))) : null;
}

function readSiteUrl(xml: string, feedUrl: string): string | null {
  const match = xml.match(/<link(?:\s[^>]*)?>([^<]+)<\/link>/i);
  if (!match?.[1]) return null;
  try {
    const url = new URL(match[1].trim(), feedUrl);
    return isSafeFeedTarget(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}
