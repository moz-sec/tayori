import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { Source } from "../types";

const source: Source = { id: "s1", folderId: null, title: "Feed", url: "https://example.com/feed", status: "active", unreadCount: 7, lastCheckedAt: null, lastSuccessAt: null, nextFetchAt: "2026-11-01T12:00:00Z", errorCode: null, consecutiveFailures: 0 };
function render(sources: Source[]) {
  return renderToStaticMarkup(createElement(Sidebar, {
    scope: "all", folderId: null, sourceId: null, folders: [{ id: "folder", parentId: null, name: "Folder", sortOrder: 0, unreadCount: 0 }], sources,
    status: { activeSources: 1, failingSources: 0, lastTickAt: "2026-11-01T11:00:00Z" }, retentionDays: 7,
    folderDialog: null, folderBusy: false, onDeleteFolder: vi.fn(), onMoveFolder: vi.fn(), onOpenSourceDialog: vi.fn(), importItems: null, importSummary: "", importRows: [], busy: false,
    onScopeChange: vi.fn(), onSelectFolder: vi.fn(), onSelectSource: vi.fn(), onOpenFolderDialog: vi.fn(),
    onCloseFolderDialog: vi.fn(), onSaveFolder: vi.fn(), onCreateSource: vi.fn(), onToggleSource: vi.fn(),
    onImportFile: vi.fn(), onImportOpml: vi.fn(),
  }));
}
describe("feed diagnostics", () => {
  it("shows unread counts and initial state in both grouped and unclassified feeds", () => {
    const html = render([source, { ...source, id: "s2", title: "Grouped", folderId: "folder", unreadCount: 0 }]);
    expect(html).toContain('未読7件');
    expect(html).toContain('未読0件');
    expect(html.match(/初回取得の確認待ち/g)).toHaveLength(2);
    expect(html).toContain('まだ確認していません');
    expect(html).toContain('まだ成功していません');
    expect(html).toContain('収集スケジューラー最終実行');
    expect(html).toContain('各フィードの取得完了を示しません');
  });
  it("retains earlier success separately from the current failure and explains the code", () => {
    const html = render([{ ...source, lastCheckedAt: "2026-11-01T11:30:00Z", lastSuccessAt: "2026-11-01T10:00:00Z", errorCode: "http_503", consecutiveFailures: 3 }]);
    expect(html).toContain('最終確認（成功・失敗を含む）');
    expect(html).toContain('最終成功（更新なしを含む）');
    expect(html).toContain('サーバーでエラー');
    expect(html).toContain('コード: http_503');
    expect(html).toContain('3回');
    expect(html).toContain('取得完了時刻ではありません');
  });
  it("does not present a paused feed stale target time as a schedule and hides archived feeds", () => {
    const html = render([{ ...source, status: "paused", errorCode: "http_429", consecutiveFailures: 1 }, { ...source, id: "archived", title: "Hidden feed", status: "archived" }]);
    expect(html).toContain('一時停止中（自動取得しません）');
    expect(html).toContain('停止中のため対象外');
    expect(html).not.toContain('Hidden feed');
    expect(html).not.toContain('取得完了時刻ではありません');
    expect(html).not.toContain('再試行します');
  });
});
