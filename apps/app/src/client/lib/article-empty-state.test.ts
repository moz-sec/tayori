import { describe, expect, it } from "vitest";
import { articleEmptyState } from "./article-empty-state";
import type { Source } from "../types";
const source: Source = { id: "s1", folderId: "child", title: "技術", url: "https://example.com/feed", status: "active", unreadCount: 0, lastCheckedAt: null, lastSuccessAt: null, nextFetchAt: "2026-11-06T12:00:00Z", errorCode: null, consecutiveFailures: 0 };
const base = { scope: "all" as const, folderId: null, sourceId: null, folders: [], sources: [] as Source[] };
describe("article empty state", () => {
  it("distinguishes no subscriptions from subscribed but not collected", () => {
    expect(articleEmptyState(base).title).toBe("購読先を追加しましょう");
    expect(articleEmptyState({ ...base, sources: [source] }).title).toBe("記事の初回取得を待っています");
  });
  it("does not ask users to add subscriptions to empty saved views", () => {
    expect(articleEmptyState({ ...base, scope: "read-later" }).title).toBe("あとで読む記事はありません");
    expect(articleEmptyState({ ...base, scope: "starred" }).title).toBe("お気に入りの記事はありません");
    expect(articleEmptyState({ ...base, scope: "unread", sources: [source] }).title).toBe("未読の記事はありません");
  });
  it("includes child subscriptions but ignores unrelated and archived sources", () => {
    const folders = [{ id: "parent", parentId: null, name: "親", sortOrder: 0, unreadCount: 0 }, { id: "child", parentId: "parent", name: "子", sortOrder: 0, unreadCount: 0 }];
    const context = { ...base, folderId: "parent", folders };
    expect(articleEmptyState({ ...context, sources: [source] }).title).toBe("記事の初回取得を待っています");
    expect(articleEmptyState({ ...context, sources: [{ ...source, folderId: "other" }] }).title).toBe("このフォルダに購読先はありません");
    expect(articleEmptyState({ ...context, sources: [{ ...source, status: "archived" }] }).title).toBe("このフォルダに購読先はありません");
  });
  it("uses the selected source rather than unrelated successful sources", () => {
    expect(articleEmptyState({ ...base, sourceId: "s1", sources: [source, { ...source, id: "s2", lastCheckedAt: "2026-11-06T12:00:00Z" }] }).title).toBe("記事の初回取得を待っています");
  });
  it("provides different next steps for paused and failed feeds", () => {
    expect(articleEmptyState({ ...base, sources: [{ ...source, status: "paused" }] }).description).toContain("再開");
    expect(articleEmptyState({ ...base, sources: [{ ...source, errorCode: "http_503" }] }).description).toContain("取得状況");
  });
});
