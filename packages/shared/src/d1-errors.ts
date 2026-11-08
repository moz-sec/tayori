export type D1QuotaCode =
  | "D1_DAILY_READ_LIMIT"
  | "D1_DAILY_WRITE_LIMIT"
  | "D1_DATABASE_STORAGE_LIMIT"
  | "D1_ACCOUNT_STORAGE_LIMIT";

/** Recognizes documented D1 quota errors, including wrapped causes, without exposing their text. */
export function classifyD1QuotaError(error: unknown): D1QuotaCode | null {
  const seen = new Set<Error>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    const message = current.message;
    if (/free tier daily row read limit/i.test(message)) return "D1_DAILY_READ_LIMIT";
    if (/free tier daily row write limit/i.test(message)) return "D1_DAILY_WRITE_LIMIT";
    if (/exceeded maximum db size/i.test(message)) return "D1_DATABASE_STORAGE_LIMIT";
    if (/D1['’]s maximum account storage limit/i.test(message)) return "D1_ACCOUNT_STORAGE_LIMIT";
    current = current.cause;
  }
  return null;
}

/** Seconds until the next UTC day, rounded up for an HTTP Retry-After header. */
export function secondsUntilNextUtcDay(nowMs: number): number {
  return Math.ceil((Math.floor(nowMs / 86_400_000 + 1) * 86_400_000 - nowMs) / 1000);
}
