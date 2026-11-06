import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArticleList } from "./ArticleList";
import type { Article } from "../types";
const article: Article = { id: "a1", sourceId: "s1", sourceTitle: "購読", title: "保持する記事", url: "https://example.com/article", author: null, summary: null, publishedAt: null, expiresAt: "2026-11-13T00:00:00Z", read: false, starred: false, readLater: false, saved: false, version: 1 };
const props = { articles: [], nextCursor: null, selectedArticleIds: [], selectionDisabled: false, onToggleSelection: vi.fn(), onUpdate: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn() };
describe("article list feedback", () => {
  it("does not claim an empty result or render old articles before a view finishes loading", () => {
    const html = renderToStaticMarkup(createElement(ArticleList, { ...props, articles: [article], loading: "initial" }));
    expect(html).toContain("記事を読み込んでいます…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("保持する記事");
    expect(html).not.toContain("記事はまだありません");
  });
  it("distinguishes a failed request from an empty result and offers retry", () => {
    const html = renderToStaticMarkup(createElement(ArticleList, { ...props, error: "接続を確認してください" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("再試行");
    expect(html).not.toContain("記事はまだありません");
  });
  it("keeps existing articles during append and after append errors", () => {
    const loading = renderToStaticMarkup(createElement(ArticleList, { ...props, articles: [article], loading: "append" }));
    expect(loading).toContain("次の記事を読み込んでいます…");
    expect(loading).toContain("保持する記事");
    const failed = renderToStaticMarkup(createElement(ArticleList, { ...props, articles: [article], error: "通信失敗" }));
    expect(failed).toContain("前回取得した内容");
    expect(failed).toContain("保持する記事");
  });
  it("announces refreshes without discarding articles and keeps background refresh visually quiet", () => {
    expect(renderToStaticMarkup(createElement(ArticleList, { ...props, articles: [article], loading: "refresh" }))).toContain("記事一覧を更新しています…");
    const background = renderToStaticMarkup(createElement(ArticleList, { ...props, articles: [article], busy: true }));
    expect(background).toContain('aria-busy="true"');
    expect(background).not.toContain("loading-spinner");
    expect(background).toContain("保持する記事");
  });
});
