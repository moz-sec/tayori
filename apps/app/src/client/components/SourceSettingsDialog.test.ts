import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceSettingsDialog } from "./SourceSettingsDialog";
import type { Source } from "../types";

const source: Source = { id: "feed", folderId: "child", title: "購読先", url: "https://example.com/feed.xml", status: "active", lastCheckedAt: null, nextFetchAt: "2026-11-01T12:00:00Z", unreadCount: 0, lastSuccessAt: null, errorCode: null, consecutiveFailures: 0 };

describe("subscription settings", () => {
  it("shows the existing name and folder, parent paths, and the archive retention policy", () => {
    const html = renderToStaticMarkup(createElement(SourceSettingsDialog, {
      source, folders: [
        { id: "parent", parentId: null, name: "親", sortOrder: 0, unreadCount: 0 },
        { id: "child", parentId: "parent", name: "子", sortOrder: 0, unreadCount: 0 },
      ], onClose: vi.fn(), onCommitted: vi.fn(),
    }));
    expect(html).toContain('value="購読先"');
    expect(html).toContain('<option value="child" selected="">親 / 子</option>');
    expect(html).toContain('value="">未分類');
    expect(html).toContain('以後のRSS収集を停止');
    expect(html).toContain('既存の記事・既読・お気に入り・あとで読むの状態は残ります');
    expect(html).toContain('すべての記事');
    expect(html).toContain('購読解除…');
    expect(html).not.toContain('確認して購読解除');
    expect(html).not.toContain('name="url"');
  });
});
