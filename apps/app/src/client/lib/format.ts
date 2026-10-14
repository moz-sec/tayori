/** Formats an ISO date using the Japanese locale, with a fallback for invalid or missing values. */
export function formatDate(value: string | null): string {
  if (!value) return "日時不明";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "日時不明" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
