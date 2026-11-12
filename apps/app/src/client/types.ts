export type Scope = "all" | "unread" | "read-later" | "starred";

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  unreadCount: number;
}

export interface Source {
  id: string;
  generation: number;
  siteUrl?: string | null;
  folderId: string | null;
  title: string;
  url: string;
  status: "active" | "archived";
  unreadCount: number;
  lastCheckedAt: string | null;
  nextFetchAt: string;
  lastSuccessAt: string | null;
  errorCode: string | null;
  consecutiveFailures: number;
}

export interface Article {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
  expiresAt: string;
  read: boolean;
  starred: boolean;
  readLater: boolean;
  saved: boolean;
  version: number;
}

export interface Page<T> {
  data: T;
  nextCursor?: string | null;
}
export interface ImportOutline {
  title: string;
  url: string;
  siteUrl?: string;
  folderPath: string[];
}
export type FolderDialog =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; folder: Folder };
