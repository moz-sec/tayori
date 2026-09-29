export const DEFAULT_RETENTION_DAYS = 7;

export type FeedFormat = "rss" | "atom" | "unknown";

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
}
