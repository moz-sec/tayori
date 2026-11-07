import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLLECTION_SCHEDULE, nextCollectionAt, parseCollectionSchedule, readCollectionSchedule,
} from "@tayori/shared/collection-schedule";
import { sqliteD1 } from "./test/sqlite-d1";

const seconds = (value: string) => Date.parse(value) / 1000;

describe("collection schedule boundaries", () => {
  it.each([1, 2, 3, 6, 12, 24] as const)("aligns %i-hour intervals without adding the full interval to completion time", (interval_hours) => {
    const now = seconds("2026-11-05T00:08:00Z");
    expect(nextCollectionAt({ ...DEFAULT_COLLECTION_SCHEDULE, interval_hours }, now))
      .toBe(seconds("2026-11-05T00:00:00Z") + interval_hours * 3_600);
  });

  it("moves an exact interval boundary to the following occurrence", () => {
    expect(nextCollectionAt({ ...DEFAULT_COLLECTION_SCHEDULE, interval_hours: 6 }, seconds("2026-11-05T06:00:00Z")))
      .toBe(seconds("2026-11-05T12:00:00Z"));
  });

  it("calculates midnight in Japan across UTC and JST date boundaries", () => {
    const schedule = { ...DEFAULT_COLLECTION_SCHEDULE, mode: "daily" as const, daily_hour_jst: 0 };
    expect(nextCollectionAt(schedule, seconds("2026-11-05T14:59:59Z"))).toBe(seconds("2026-11-05T15:00:00Z"));
    expect(nextCollectionAt(schedule, seconds("2026-11-05T15:00:00Z"))).toBe(seconds("2026-11-06T15:00:00Z"));
    expect(nextCollectionAt(schedule, seconds("2026-12-31T15:01:00Z"))).toBe(seconds("2027-01-01T15:00:00Z"));
  });

  it("validates inactive values, timezone, and numeric types", () => {
    expect(parseCollectionSchedule(DEFAULT_COLLECTION_SCHEDULE)).toEqual(DEFAULT_COLLECTION_SCHEDULE);
    for (const override of [
      { mode: "weekly" }, { timezone: "UTC" }, { interval_hours: 4 }, { interval_hours: "1" },
      { daily_hour_jst: 24 }, { daily_hour_jst: -1 }, { daily_hour_jst: 0.5 }, { daily_hour_jst: "0" },
    ]) expect(parseCollectionSchedule({ ...DEFAULT_COLLECTION_SCHEDULE, ...override })).toBeNull();
    expect(parseCollectionSchedule(null)).toBeNull();
    expect(parseCollectionSchedule([])).toBeNull();
  });

  it("defaults to hourly for an absent or invalid stored setting", async () => {
    const db = sqliteD1();
    try {
      expect(await readCollectionSchedule(db.binding)).toEqual(DEFAULT_COLLECTION_SCHEDULE);
      db.sqlite.prepare("INSERT INTO app_state(key,value) VALUES ('collection_schedule',?)").run("broken-json");
      expect(await readCollectionSchedule(db.binding)).toEqual(DEFAULT_COLLECTION_SCHEDULE);
      db.sqlite.prepare("UPDATE app_state SET value=? WHERE key='collection_schedule'")
        .run(JSON.stringify({ ...DEFAULT_COLLECTION_SCHEDULE, interval_hours: 4 }));
      expect(await readCollectionSchedule(db.binding)).toEqual(DEFAULT_COLLECTION_SCHEDULE);
    } finally { db.sqlite.close(); }
  });
});
