import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceSettingsDialog } from "./SourceSettingsDialog";
import type { Source } from "../types";

const source: Source = {
  id: "source",
  generation: 1,
  folderId: null,
  title: "Feed",
  url: "https://example.com/feed",
  status: "active",
  unreadCount: 0,
  lastCheckedAt: "2026-11-01T11:30:00Z",
  lastSuccessAt: "2026-11-01T10:00:00Z",
  nextFetchAt: "2026-11-01T12:00:00Z",
  errorCode: "http_503",
  consecutiveFailures: 3,
};
function render(item: Source) {
  return renderToStaticMarkup(
    createElement(SourceSettingsDialog, {
      source: item,
      folders: [],
      onClose: vi.fn(),
      onCommitted: vi.fn(),
      onConflict: vi.fn(),
    }),
  );
}
describe("subscription collection status", () => {
  it("shows collection details and the current error in settings", () => {
    const html = render(source);
    expect(html).toContain('aria-label="閉じる"');
    expect(html).toContain("最終確認（成功・失敗を含む）");
    expect(html).toContain("最終成功（更新なしを含む）");
    expect(html).toContain("サーバーでエラー");
    expect(html).toContain("コード: http_503");
    expect(html).toContain('font-semibold text-error">取得状況（取得エラー）</summary>');
    expect(html).toContain("3回");
    expect(html).toContain("取得完了時刻ではありません");
  });
  it("does not offer a pause control", () => {
    expect(render(source)).not.toContain("一時停止");
  });
  it("shows a normal status label when there is no error", () => {
    expect(render({ ...source, errorCode: null })).toContain('font-semibold ">取得状況</summary>');
  });
});
