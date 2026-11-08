import type { D1Database } from "@cloudflare/workers-types";

export const COLLECTION_SCHEDULE_KEY = "collection_schedule";
export const COLLECTION_INTERVAL_HOURS = [1, 2, 3, 6, 12, 24] as const;

export interface CollectionSchedule {
  mode: "interval" | "daily";
  interval_hours: (typeof COLLECTION_INTERVAL_HOURS)[number];
  daily_hour_jst: number;
  timezone: "Asia/Tokyo";
}

export const DEFAULT_COLLECTION_SCHEDULE: Readonly<CollectionSchedule> = Object.freeze({
  mode: "interval",
  interval_hours: 1,
  daily_hour_jst: 0,
  timezone: "Asia/Tokyo",
});

/** Validates both active and inactive fields so switching modes keeps a valid setting. */
export function parseCollectionSchedule(value: unknown): CollectionSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    (row.mode !== "interval" && row.mode !== "daily") ||
    row.timezone !== "Asia/Tokyo" ||
    !COLLECTION_INTERVAL_HOURS.includes(
      row.interval_hours as CollectionSchedule["interval_hours"],
    ) ||
    !Number.isInteger(row.daily_hour_jst) ||
    Number(row.daily_hour_jst) < 0 ||
    Number(row.daily_hour_jst) > 23
  )
    return null;
  return {
    mode: row.mode,
    interval_hours: row.interval_hours as CollectionSchedule["interval_hours"],
    daily_hour_jst: Number(row.daily_hour_jst),
    timezone: "Asia/Tokyo",
  };
}

/** Returns the next boundary strictly after now (Unix seconds), independent of delivery latency. */
export function nextCollectionAt(schedule: CollectionSchedule, now: number): number {
  if (schedule.mode === "interval") {
    const interval = schedule.interval_hours * 3_600;
    return (Math.floor(now / interval) + 1) * interval;
  }
  const jstOffset = 9 * 3_600;
  const today = Math.floor((now + jstOffset) / 86_400) * 86_400 - jstOffset;
  const target = today + schedule.daily_hour_jst * 3_600;
  return target > now ? target : target + 86_400;
}

/** Keeps the stored value for compare-and-set when a setting changes during collection. */
export async function loadCollectionSchedule(db: D1Database): Promise<{
  schedule: CollectionSchedule;
  storedValue: string;
}> {
  const row = await db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(COLLECTION_SCHEDULE_KEY)
    .first<{ value: string }>();
  const storedValue = row?.value ?? "";
  let schedule: CollectionSchedule | null = null;
  try {
    schedule = parseCollectionSchedule(JSON.parse(storedValue));
  } catch {
    /* Unconfigured defaults to hourly. */
  }
  return { schedule: schedule ?? { ...DEFAULT_COLLECTION_SCHEDULE }, storedValue };
}

/** Loads a validated persisted schedule, falling back to the hourly default. */
export async function readCollectionSchedule(db: D1Database): Promise<CollectionSchedule> {
  return (await loadCollectionSchedule(db)).schedule;
}
