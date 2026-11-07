/** An account-wide observation. Daily counts use the UTC calendar date. */
export interface D1UsageSnapshot {
  observedAt: string;
  dayUtc: string;
  storageBytes: number;
  rowsRead: number;
  rowsWritten: number;
}

export interface D1UsageLimits {
  storageBytes: number;
  rowsRead: number;
  rowsWritten: number;
  warningRatio: number;
  maxAgeSeconds: number;
}

export type D1UsageMetric = "storageBytes" | "rowsRead" | "rowsWritten";
export interface D1UsageStatus {
  state: "ok" | "warning" | "stopped";
  reason: "within_limits" | "approaching_limit" | "limit_reached" | "unavailable";
  metrics: D1UsageMetric[];
  snapshot: D1UsageSnapshot | null;
}

const metrics: D1UsageMetric[] = ["storageBytes", "rowsRead", "rowsWritten"];
const finiteNonnegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Unknown, stale, future, or previous-day observations fail closed. */
export function evaluateD1Usage(
  snapshot: D1UsageSnapshot | null,
  limits: D1UsageLimits,
  now: Date = new Date(),
): D1UsageStatus {
  const unavailable = (): D1UsageStatus => ({
    state: "stopped",
    reason: "unavailable",
    metrics: [],
    snapshot: null,
  });
  const nowMs = now.getTime();
  if (
    !snapshot ||
    !Number.isFinite(nowMs) ||
    !metrics.every((key) => finiteNonnegative(snapshot[key])) ||
    !metrics.every((key) => finiteNonnegative(limits[key]) && limits[key] > 0) ||
    !finiteNonnegative(limits.warningRatio) ||
    limits.warningRatio <= 0 ||
    limits.warningRatio >= 1 ||
    !finiteNonnegative(limits.maxAgeSeconds) ||
    limits.maxAgeSeconds <= 0
  )
    return unavailable();
  const observedMs = Date.parse(snapshot.observedAt);
  if (
    !Number.isFinite(observedMs) ||
    observedMs > nowMs ||
    nowMs - observedMs > limits.maxAgeSeconds * 1000 ||
    snapshot.dayUtc !== now.toISOString().slice(0, 10) ||
    snapshot.dayUtc !== new Date(observedMs).toISOString().slice(0, 10)
  )
    return unavailable();
  const exceeded = metrics.filter((key) => snapshot[key] >= limits[key]);
  if (exceeded.length)
    return { state: "stopped", reason: "limit_reached", metrics: exceeded, snapshot };
  const warning = metrics.filter((key) => snapshot[key] >= limits[key] * limits.warningRatio);
  if (warning.length)
    return { state: "warning", reason: "approaching_limit", metrics: warning, snapshot };
  return { state: "ok", reason: "within_limits", metrics: [], snapshot };
}

export const D1_USAGE_SNAPSHOT_KEY = "d1_usage_snapshot";

export interface D1UsageCredentials {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

/** Fetch account-wide daily row counts and the monitored database's size. */
export async function fetchD1Usage(
  credentials: D1UsageCredentials,
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<D1UsageSnapshot> {
  const dayUtc = now.toISOString().slice(0, 10);
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    redirect: "error",
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query D1Usage($account: string!, $day: Date!) {
        viewer { accounts(filter: {accountTag: $account}) {
          d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date: $day}) {
            sum { rowsRead rowsWritten }
          }
        } }
      }`,
      variables: { account: credentials.accountId, day: dayUtc },
    }),
  });
  if (!response.ok) throw new Error(`D1 analytics request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Invalid D1 analytics response");
  const result = body as {
    errors?: unknown;
    data?: {
      viewer?: {
        accounts?: Array<{
          d1AnalyticsAdaptiveGroups?: Array<{
            sum?: { rowsRead?: unknown; rowsWritten?: unknown };
          }>;
        }>;
      };
    };
  };
  const accounts = result.data?.viewer?.accounts;
  if (result.errors || !Array.isArray(accounts) || accounts.length !== 1)
    throw new Error("D1 analytics unavailable");
  const rows = accounts[0].d1AnalyticsAdaptiveGroups;
  const sizeResponse = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/d1/database/${encodeURIComponent(credentials.databaseId)}`,
    {
      headers: { Authorization: `Bearer ${credentials.apiToken}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  if (!sizeResponse.ok) throw new Error(`D1 database info request failed (${sizeResponse.status})`);
  const sizeBody = (await sizeResponse.json()) as {
    success?: boolean;
    result?: { file_size?: unknown };
  };
  const storageBytes = sizeBody.result?.file_size;
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length >= 10000 ||
    !rows.every(
      (row) => finiteNonnegative(row.sum?.rowsRead) && finiteNonnegative(row.sum?.rowsWritten),
    ) ||
    sizeBody.success !== true ||
    !finiteNonnegative(storageBytes)
  )
    throw new Error("Incomplete D1 analytics response");
  return {
    observedAt: now.toISOString(),
    dayUtc,
    rowsRead: rows.reduce((sum, row) => sum + Number(row.sum?.rowsRead), 0),
    rowsWritten: rows.reduce((sum, row) => sum + Number(row.sum?.rowsWritten), 0),
    storageBytes,
  };
}

interface UsageDatabase {
  prepare(query: string): {
    bind(...values: string[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> };
  };
}

/** Read only a cached observation; malformed or missing state is unavailable. */
export async function readD1UsageSnapshot(db: UsageDatabase): Promise<D1UsageSnapshot | null> {
  const row = await db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(D1_USAGE_SNAPSHOT_KEY)
    .first<{ value: string }>();
  try {
    const value: unknown = JSON.parse(row?.value ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as D1UsageSnapshot;
    if (
      typeof snapshot.observedAt !== "string" ||
      typeof snapshot.dayUtc !== "string" ||
      !metrics.every((key) => finiteNonnegative(snapshot[key]))
    )
      return null;
    return snapshot;
  } catch {
    return null;
  }
}

export async function writeD1UsageSnapshot(
  db: UsageDatabase,
  snapshot: D1UsageSnapshot,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO app_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(D1_USAGE_SNAPSHOT_KEY, JSON.stringify(snapshot))
    .run();
}

export const D1_USAGE_CONFIG_KEY = "d1_usage_config";
export type D1UsageControlStatus =
  | D1UsageStatus
  | { state: "disabled"; reason: "disabled"; metrics: []; snapshot: null };
export interface D1UsageConfig {
  enabled: boolean;
  limits: D1UsageLimits | null;
}

export async function writeD1UsageConfig(db: UsageDatabase, config: D1UsageConfig): Promise<void> {
  await db
    .prepare(
      "INSERT INTO app_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(D1_USAGE_CONFIG_KEY, JSON.stringify(config))
    .run();
}

/** Missing configuration is disabled; invalid enabled configuration fails closed. */
export async function readD1UsageStatus(
  db: UsageDatabase,
  now: Date = new Date(),
): Promise<D1UsageControlStatus> {
  const row = await db
    .prepare(
      "SELECT (SELECT value FROM app_state WHERE key = ?) AS value, (SELECT value FROM app_state WHERE key = ?) AS snapshot",
    )
    .bind(D1_USAGE_CONFIG_KEY, D1_USAGE_SNAPSHOT_KEY)
    .first<{ value: string | null; snapshot: string | null }>();
  if (!row?.value) return { state: "disabled", reason: "disabled", metrics: [], snapshot: null };
  try {
    const config: unknown = JSON.parse(row.value);
    if (config && typeof config === "object" && "enabled" in config && config.enabled === false)
      return { state: "disabled", reason: "disabled", metrics: [], snapshot: null };
    if (
      config &&
      typeof config === "object" &&
      "enabled" in config &&
      config.enabled === true &&
      "limits" in config &&
      config.limits &&
      typeof config.limits === "object"
    )
      return evaluateD1Usage(
        JSON.parse(row.snapshot ?? "null") as D1UsageSnapshot | null,
        config.limits as D1UsageLimits,
        now,
      );
  } catch {
    /* Invalid persisted configuration fails closed. */
  }
  return { state: "stopped", reason: "unavailable", metrics: [], snapshot: null };
}
