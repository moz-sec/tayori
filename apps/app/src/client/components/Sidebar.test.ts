import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { Source } from "../types";

const source: Source = {
  id: "s1",
  generation: 1,
  folderId: null,
  title: "Feed",
  url: "https://example.com/feed",
  siteUrl: "https://publisher.example/blog",
  status: "active",
  unreadCount: 7,
  lastCheckedAt: null,
  lastSuccessAt: null,
  nextFetchAt: "2026-11-01T12:00:00Z",
  errorCode: null,
  consecutiveFailures: 0,
};
function render(sources: Source[]) {
  return renderToStaticMarkup(
    createElement(Sidebar, {
      scope: "all",
      folderId: null,
      sourceId: null,
      folders: [{ id: "folder", parentId: null, name: "Folder", sortOrder: 0, unreadCount: 0 }],
      sources,
      status: { activeSources: 1, failingSources: 0, lastTickAt: "2026-11-01T11:00:00Z" },
      retentionDays: 7,
      folderDialog: null,
      folderBusy: false,
      onDeleteFolder: vi.fn(),
      onMoveFolder: vi.fn(),
      onRelocateItem: vi.fn(),
      onOpenSourceDialog: vi.fn(),
      onOpenAddSource: vi.fn(),
      onOpenImportOpml: vi.fn(),
      onScopeChange: vi.fn(),
      onSelectFolder: vi.fn(),
      onSelectSource: vi.fn(),
      onOpenFolderDialog: vi.fn(),
      onCloseFolderDialog: vi.fn(),
      onSaveFolder: vi.fn(),
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("feed diagnostics", () => {
  it("shows unread counts and initial state in both grouped and unclassified feeds", () => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
      localStorage: { getItem: () => '["folder"]' },
    });
    const html = render([
      source,
      { ...source, id: "s2", title: "Grouped", folderId: "folder", unreadCount: 0 },
    ]);
    expect(html).toContain("未読7件");
    expect(html).toContain('src="https://publisher.example/favicon.ico"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("未読0件");
    expect(html).not.toContain("取得状況");
    expect(html).toContain("収集スケジューラー最終実行");
    expect(html).not.toContain("未分類");
    expect(html).toMatch(/購読先[\s\S]*<ul[^>]*>[\s\S]*Feedの購読設定[\s\S]*<\/ul>/);
  });
  it("keeps folders closed by default", () => {
    const html = render([{ ...source, folderId: "folder", title: "Grouped" }]);
    expect(html).toContain("Folderを展開");
    expect(html).toContain("「Folder」のフォルダ設定");
    expect(html).not.toContain("Folderの操作");
    expect(html).not.toContain("Grouped");
  });
  it("marks failing feeds in the sidebar", () => {
    const html = render([{ ...source, errorCode: "http_503" }]);
    expect(html).toContain('title="Feed（取得エラー）"');
    expect(html).toContain('class="min-w-0 flex-1 truncate text-error"');
    expect(html).toContain('class="sr-only">（取得エラー）');
    expect(render([source])).not.toContain("取得エラー");
  });
});
