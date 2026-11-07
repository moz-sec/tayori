import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DEFAULT_COLLECTION_SCHEDULE, nextCollectionAt, parseCollectionSchedule } from "@tayori/shared/collection-schedule";

/** Mounted below the main API's Access, origin, and JSON middleware. */
export const collectionSettingsApi = new Hono<{ Bindings: Env }>();

collectionSettingsApi.get("/collection-schedule", async (c) => {
  return c.json({ data: await readSnapshot(c.env.DB) });
});

collectionSettingsApi.put("/collection-schedule", bodyLimit({
  maxSize: 4096,
  onError: (c) => c.json({ error: { code: "REQUEST_TOO_LARGE" } }, 413),
}), async (c) => {
  let input: unknown;
  try { input = await c.req.json(); }
  catch { return c.json({ error: { code: "INVALID_COLLECTION_SCHEDULE" } }, 400); }
  const schedule = parseCollectionSchedule(input);
  if (!schedule) return c.json({ error: { code: "INVALID_COLLECTION_SCHEDULE" } }, 400);
  const now = Math.floor(Date.now() / 1000);
  // Keep in-flight jobs and failure cooldowns. Both writes succeed or roll back together.
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO app_state(key, value) VALUES ('collection_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(schedule)),
    c.env.DB.prepare("UPDATE sources SET next_fetch_at = MAX(?, COALESCE(retry_not_before, 0))")
      .bind(nextCollectionAt(schedule, now)),
  ]);
  return c.json({ data: await readSnapshot(c.env.DB) });
});

/** Reads settings and their earliest due time from the same SQLite snapshot. */
async function readSnapshot(db: D1Database) {
  const row = await db.prepare(`SELECT
    (SELECT value FROM app_state WHERE key = 'collection_schedule') AS value,
    (SELECT MIN(next_fetch_at) FROM sources WHERE status = 'active') AS next`)
    .first<{ value: string | null; next: number | null }>();
  let schedule = null;
  try { schedule = parseCollectionSchedule(JSON.parse(row?.value ?? "")); } catch { /* Use the Collector's default. */ }
  return { ...(schedule ?? DEFAULT_COLLECTION_SCHEDULE), next_fetch_at: toIso(row?.next) };
}

/** Formats a stored due time for the API, retaining null when there are no active sources. */
function toIso(seconds: number | null | undefined) {
  return seconds == null ? null : new Date(seconds * 1000).toISOString();
}
