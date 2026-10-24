export const DEFAULT_RETENTION_DAYS = 7;
export const MAX_FEED_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_ARTICLES_PER_FEED = 200;
export const MAX_QUEUE_OPERATIONS_PER_DAY = 8_000;

export type FeedFormat = "rss" | "atom" | "unknown";

export type QueueMessage =
  | { schemaVersion: 1; type: "tick"; scheduledAt: number; cursor?: string }
  | { schemaVersion: 1; type: "fetch"; jobId: string };

export interface FeedSummary {
  id: string;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  folderId: string | null;
  unreadCount: number;
}

export interface ArticleSummary {
  id: string;
  feedId: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  summary: string | null;
  isRead: boolean;
  isSaved: boolean;
  version: number;
}

export function normalizeFeedUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS feed URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Feed URLs must not contain credentials.");
  }
  if (isUnsafeHost(url.hostname)) {
    throw new Error("Local and private network addresses are not allowed.");
  }
  url.hash = "";
  return url.toString();
}

export function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }

  if (host.includes(":")) {
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") ||
      /^fe[89ab]/.test(host) || host.startsWith("ff") || host.startsWith("::ffff:");
  }
  return false;
}
