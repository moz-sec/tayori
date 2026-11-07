import { MAX_QUEUE_OPERATIONS_PER_DAY } from "@tayori/shared";

/** Aggregate-only monitoring: no feed identifiers, URLs, content or exception text leave the Worker. */
export interface MonitoringOptions {
  webhookUrl?: string;
  tickStaleSeconds?: number;
  backlogStaleSeconds?: number;
  failureThreshold?: number;
  budgetStopped?: boolean;
}

export interface MonitoringSnapshot {
  lastTick: number | null;
  lastSuccess: number | null;
  failingSources: number;
  maxConsecutiveFailures: number;
  queueBudgetStopped: boolean;
  oldestPending: number | null;
  budgetStopped: boolean;
}

function threshold(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

export async function readMonitoringSnapshot(
  db: D1Database,
  failureThreshold: number,
  budgetStopped = false,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MonitoringSnapshot> {
  const row = await db
    .prepare(`SELECT
    (SELECT CAST(value AS INTEGER) FROM app_state WHERE key = 'last_tick') AS lastTick,
    (SELECT MAX(last_success_at) FROM sources WHERE status = 'active') AS lastSuccess,
    (SELECT COUNT(*) FROM sources WHERE status = 'active' AND consecutive_failures >= ?) AS failingSources,
    COALESCE((SELECT MAX(consecutive_failures) FROM sources WHERE status = 'active'), 0) AS maxConsecutiveFailures,
    COALESCE((SELECT reserved_queue_ops > ? FROM daily_usage WHERE day_utc = ?), 0) AS queueBudgetStopped,
    (SELECT MIN(created_at) FROM fetch_jobs WHERE status IN ('pending', 'sent', 'running')) AS oldestPending`)
    .bind(
      failureThreshold,
      MAX_QUEUE_OPERATIONS_PER_DAY - 4,
      new Date(nowSeconds * 1000).toISOString().slice(0, 10),
    )
    .first<Omit<MonitoringSnapshot, "budgetStopped">>();
  if (!row) throw new Error("Monitoring snapshot unavailable");
  return {
    ...row,
    queueBudgetStopped: Boolean(row.queueBudgetStopped),
    budgetStopped: budgetStopped || Boolean(row.queueBudgetStopped),
  };
}

/** Call from the hourly scheduled handler before publishing its tick. */
export async function runMonitoring(
  db: D1Database,
  nowSeconds: number,
  options: MonitoringOptions,
): Promise<void> {
  if (!options.webhookUrl) return;
  const url = new URL(options.webhookUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid monitoring webhook");
  const snapshot = await readMonitoringSnapshot(
    db,
    threshold(options.failureThreshold, 3),
    options.budgetStopped,
    nowSeconds,
  );
  const stored = await db
    .prepare("SELECT value FROM app_state WHERE key = 'monitoring_state'")
    .first<{ value: string }>();
  let previous: { startedAt: number; active: string[] } = { startedAt: nowSeconds, active: [] };
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored.value);
      if (
        parsed &&
        typeof parsed === "object" &&
        Number.isSafeInteger((parsed as typeof previous).startedAt) &&
        Array.isArray((parsed as typeof previous).active)
      )
        previous = parsed as typeof previous;
    } catch {
      /* Reset invalid state. */
    }
  }
  const known = new Set(["tick_stale", "queue_stale", "feed_failures", "budget_stopped"]);
  previous.active = previous.active.filter(
    (value) => typeof value === "string" && known.has(value),
  );
  const active: string[] = [];
  if (
    nowSeconds - (snapshot.lastTick ?? previous.startedAt) >=
    threshold(options.tickStaleSeconds, 3 * 3600)
  )
    active.push("tick_stale");
  if (
    snapshot.oldestPending !== null &&
    nowSeconds - snapshot.oldestPending >= threshold(options.backlogStaleSeconds, 3 * 3600)
  )
    active.push("queue_stale");
  if (snapshot.failingSources > 0) active.push("feed_failures");
  if (snapshot.budgetStopped) active.push("budget_stopped");
  const started = active.filter((condition) => !previous.active.includes(condition));
  const recovered = previous.active.filter((condition) => !active.includes(condition));
  if (started.length || recovered.length) {
    // Fixed condition names only; never include the response body or URL in errors/logs.
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `Tayori monitor: ${started
            .map((x) => `${x} started`)
            .concat(recovered.map((x) => `${x} recovered`))
            .join(", ")}`,
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Monitoring notification failed");
    }
    if (!response.ok) throw new Error("Monitoring notification failed");
    await response.body?.cancel();
  }
  await db
    .prepare(
      "INSERT INTO app_state(key, value) VALUES ('monitoring_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(JSON.stringify({ startedAt: previous.startedAt, active }))
    .run();
}

/** Environment variables are optional; absent webhook disables monitoring. */
export interface MonitoringEnv {
  DB: D1Database;
  MONITOR_WEBHOOK_URL?: string;
  MONITOR_TICK_STALE_SECONDS?: string;
  MONITOR_BACKLOG_STALE_SECONDS?: string;
  MONITOR_FAILURE_THRESHOLD?: string;
}

export function monitoringOptions(env: MonitoringEnv, budgetStopped = false): MonitoringOptions {
  return {
    webhookUrl: env.MONITOR_WEBHOOK_URL,
    tickStaleSeconds: Number(env.MONITOR_TICK_STALE_SECONDS),
    backlogStaleSeconds: Number(env.MONITOR_BACKLOG_STALE_SECONDS),
    failureThreshold: Number(env.MONITOR_FAILURE_THRESHOLD),
    budgetStopped,
  };
}
