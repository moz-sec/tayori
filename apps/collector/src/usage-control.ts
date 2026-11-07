import {
  fetchD1Usage,
  readD1UsageStatus,
  writeD1UsageConfig,
  writeD1UsageSnapshot,
  type D1UsageLimits,
} from "@tayori/shared/d1-usage";
import type { D1Database } from "@cloudflare/workers-types";

export interface UsageControlEnv {
  DB: D1Database;
  D1_USAGE_ENABLED?: string;
  D1_ANALYTICS_TOKEN?: string;
  D1_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
  D1_STORAGE_LIMIT_BYTES?: string;
  D1_ROWS_READ_LIMIT?: string;
  D1_ROWS_WRITTEN_LIMIT?: string;
  D1_WARNING_RATIO?: string;
  D1_MAX_AGE_SECONDS?: string;
}

/** Refresh independently of collection; failures retain the last observation. */
export async function refreshUsageControl(env: UsageControlEnv, nowSec: number): Promise<void> {
  if (!env.D1_USAGE_ENABLED || env.D1_USAGE_ENABLED === "false") {
    await writeD1UsageConfig(env.DB, { enabled: false, limits: null });
    return;
  }
  const limits: D1UsageLimits = {
    storageBytes: Number(env.D1_STORAGE_LIMIT_BYTES),
    rowsRead: Number(env.D1_ROWS_READ_LIMIT),
    rowsWritten: Number(env.D1_ROWS_WRITTEN_LIMIT),
    warningRatio: Number(env.D1_WARNING_RATIO),
    maxAgeSeconds: Number(env.D1_MAX_AGE_SECONDS),
  };
  if (
    env.D1_USAGE_ENABLED !== "true" ||
    !env.D1_ANALYTICS_TOKEN ||
    !env.D1_ACCOUNT_ID ||
    !env.D1_DATABASE_ID
  ) {
    await writeD1UsageConfig(env.DB, { enabled: true, limits: null });
    return;
  }
  await writeD1UsageConfig(env.DB, { enabled: true, limits });
  try {
    const snapshot = await fetchD1Usage(
      {
        accountId: env.D1_ACCOUNT_ID,
        databaseId: env.D1_DATABASE_ID,
        apiToken: env.D1_ANALYTICS_TOKEN,
      },
      new Date(nowSec * 1000),
    );
    await writeD1UsageSnapshot(env.DB, snapshot);
  } catch {
    console.error("D1_USAGE_REFRESH_FAILED");
  }
}

export function loadUsageControl(db: D1Database, nowSec: number) {
  return readD1UsageStatus(db, new Date(nowSec * 1000));
}
