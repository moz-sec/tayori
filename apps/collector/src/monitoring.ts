import { MAX_QUEUE_OPERATIONS_PER_DAY } from "@tayori/shared";
import { loadUsageControl } from "./usage-control";

/** Reads aggregate operational metrics without persisting monitoring state. */
export async function readMonitoringSnapshot(db: D1Database, now: number) {
  const [row, usage] = await Promise.all([
    db
      .prepare(`SELECT
      (SELECT CAST(value AS INTEGER) FROM app_state WHERE key = 'last_tick') AS lastTick,
      (SELECT MAX(last_success_at) FROM sources WHERE status = 'active') AS lastSuccess,
      (SELECT COUNT(*) FROM sources WHERE status = 'active' AND consecutive_failures > 0) AS failingSources,
      COALESCE((SELECT MAX(consecutive_failures) FROM sources WHERE status = 'active'), 0) AS maxConsecutiveFailures,
      (SELECT COUNT(*) FROM fetch_jobs WHERE status IN ('pending', 'sent', 'running')) AS pendingJobs,
      (SELECT MIN(created_at) FROM fetch_jobs WHERE status IN ('pending', 'sent', 'running')) AS oldestPending,
      COALESCE((SELECT reserved_queue_ops > ? FROM daily_usage WHERE day_utc = ?), 0) AS queueBudgetStopped`)
      .bind(MAX_QUEUE_OPERATIONS_PER_DAY - 4, new Date(now * 1000).toISOString().slice(0, 10))
      .first<{
        lastTick: number | null;
        lastSuccess: number | null;
        failingSources: number;
        maxConsecutiveFailures: number;
        pendingJobs: number;
        oldestPending: number | null;
        queueBudgetStopped: number;
      }>(),
    loadUsageControl(db, now),
  ]);
  if (!row) throw new Error("Monitoring snapshot unavailable");
  return {
    lastTick: row.lastTick,
    lastSuccess: row.lastSuccess,
    failingSources: row.failingSources,
    maxConsecutiveFailures: row.maxConsecutiveFailures,
    pendingJobs: row.pendingJobs,
    oldestPendingAgeSeconds:
      row.oldestPending === null ? null : Math.max(0, now - row.oldestPending),
    queueBudgetStopped: Boolean(row.queueBudgetStopped),
    d1UsageState: usage.state,
    d1UsageReason: usage.reason,
  };
}
