import { LuMail, LuStar } from "react-icons/lu";
import type { Article } from "../types";
import { formatDate } from "../lib/format";
import type { ArticleEmptyState } from "../lib/article-empty-state";

interface ArticleListProps {
  articles: Article[];
  loading?: "initial" | "refresh" | "append" | null;
  busy?: boolean;
  error?: string | null;
  emptyState?: ArticleEmptyState;
  onRetry?: () => void;
  nextCursor: string | null;
  loadMoreDisabled?: boolean;
  updatesDisabled?: boolean;
  selectedArticleIds: string[];
  selectionDisabled: boolean;
  onToggleSelection: (id: string) => void;
  onUpdate: (article: Article, changes: Record<string, unknown>, message: string) => void;
  onLoadMore: () => void;
}

/** Renders the article list, empty state, and load-more action. */
export function ArticleList({
  articles,
  nextCursor,
  loading = null,
  busy = false,
  error = null,
  emptyState = {
    title: "記事はまだありません",
    description: "新しい記事が届くと、ここに表示されます。",
  },
  onRetry,
  loadMoreDisabled = false,
  updatesDisabled = false,
  selectedArticleIds,
  selectionDisabled,
  onToggleSelection,
  onUpdate,
  onLoadMore,
}: ArticleListProps) {
  const selectedIds = new Set(selectedArticleIds);
  const initialLoading = loading === "initial";
  return (
    <section aria-label="記事一覧" aria-busy={busy || !!loading}>
      <div role="status" aria-live="polite" className="mb-3 text-sm">
        {loading && (
          <span className="inline-flex items-center gap-2">
            <span className="loading loading-spinner loading-xs" aria-hidden="true" />
            {initialLoading
              ? "記事を読み込んでいます…"
              : loading === "append"
                ? "次の記事を読み込んでいます…"
                : "記事一覧を更新しています…"}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="alert alert-error mb-5">
          <div>
            <p>
              {articles.length
                ? "記事一覧を更新できませんでした。表示中の記事は前回取得した内容です。"
                : "記事一覧を読み込めませんでした。"}
            </p>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onRetry}>
            再試行
          </button>
        </div>
      )}
      {!initialLoading && !error && articles.length === 0 && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body items-center py-16 text-center">
            <LuMail className="text-4xl text-primary/60" aria-hidden="true" />
            <h2 className="card-title mt-2">{emptyState.title}</h2>
            <p className="max-w-sm text-base-content/65">{emptyState.description}</p>
          </div>
        </div>
      )}
      {!initialLoading && articles.length > 0 && (
        <div className="divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              updatesDisabled={updatesDisabled}
              selected={selectedIds.has(article.id)}
              selectionDisabled={selectionDisabled}
              onToggleSelection={onToggleSelection}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
      {!initialLoading && nextCursor && (
        <div className="mt-7 text-center">
          <button className="btn btn-outline" disabled={loadMoreDisabled} onClick={onLoadMore}>
            {loading === "append" ? "読み込んでいます…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </section>
  );
}

/** Renders an article summary and its read, save, and favorite actions. */
function ArticleCard({
  article,
  updatesDisabled,
  selected,
  selectionDisabled,
  onToggleSelection,
  onUpdate,
}: {
  article: Article;
  updatesDisabled: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelection: ArticleListProps["onToggleSelection"];
  onUpdate: ArticleListProps["onUpdate"];
}) {
  return (
    <article className="card min-w-0 wrap-anywhere rounded-none bg-base-100">
      <div className="card-body min-w-0 gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/75">
          <label className="flex cursor-pointer items-center gap-2 text-base-content">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={selected}
              disabled={selectionDisabled}
              onChange={() => onToggleSelection(article.id)}
              aria-label={`「${article.title}」を選択`}
            />
            <span>選択</span>
          </label>
          <span className="min-w-0 max-w-full font-semibold text-primary">
            {article.sourceTitle}
          </span>
          <span aria-hidden="true">·</span>
          <time>{formatDate(article.publishedAt ?? article.expiresAt)}</time>
          <span className={`badge badge-xs ${article.read ? "badge-outline" : "badge-primary"}`}>
            {article.read ? "既読" : "未読"}
          </span>
        </div>
        <a
          className="link link-hover text-xl font-semibold leading-snug text-base-content"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (!article.read && !updatesDisabled)
              onUpdate(article, { read: true }, "既読にしました");
          }}
        >
          {article.title}
        </a>
        {article.author && <p className="text-sm text-base-content/75">{article.author}</p>}
        {article.summary && (
          <p className="line-clamp-3 whitespace-pre-line text-sm leading-6 text-base-content/75">
            {article.summary}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            className="btn btn-sm btn-ghost"
            disabled={updatesDisabled}
            onClick={() =>
              onUpdate(
                article,
                { read: !article.read },
                article.read ? "未読に戻しました" : "既読にしました",
              )
            }
          >
            {article.read ? "未読に戻す" : "既読にする"}
          </button>
          <button
            className={`btn btn-sm btn-ghost ${article.readLater ? "text-primary" : ""}`}
            disabled={updatesDisabled}
            aria-pressed={article.readLater}
            onClick={() =>
              onUpdate(
                article,
                { readLater: !article.readLater },
                article.readLater ? "保存を解除しました" : "あとで読むに保存しました",
              )
            }
          >
            {article.readLater && <span aria-hidden="true">✓ </span>}あとで読む
          </button>
          <button
            className={`btn btn-sm btn-ghost ${article.starred ? "text-primary" : ""}`}
            disabled={updatesDisabled}
            aria-pressed={article.starred}
            onClick={() =>
              onUpdate(
                article,
                { starred: !article.starred },
                article.starred ? "お気に入りを解除しました" : "お気に入りに追加しました",
              )
            }
          >
            <LuStar
              aria-hidden="true"
              className="mr-1"
              fill={article.starred ? "currentColor" : "none"}
            />
            お気に入り
          </button>
          {article.starred && (
            <span className="text-xs text-base-content/75">お気に入り登録済み</span>
          )}
          <span className="ml-auto text-xs text-base-content/75">
            保存期限 {formatDate(article.expiresAt)}
          </span>
        </div>
      </div>
    </article>
  );
}
