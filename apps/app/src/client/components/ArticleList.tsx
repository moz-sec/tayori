import { LuMail, LuStar } from "react-icons/lu";
import type { Article } from "../types";
import { formatDate } from "../lib/format";

interface ArticleListProps {
  articles: Article[];
  nextCursor: string | null;
  onUpdate: (article: Article, changes: Record<string, unknown>, message: string) => void;
  onLoadMore: () => void;
}

/** Renders the article list, empty state, and load-more action. */
export function ArticleList({ articles, nextCursor, onUpdate, onLoadMore }: ArticleListProps) {
  if (articles.length === 0) {
    return <div className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body items-center py-16 text-center">
        <LuMail className="text-4xl text-primary/60" aria-hidden="true" />
        <h2 className="card-title mt-2">記事はまだありません</h2>
        <p className="max-w-sm text-base-content/65">購読先を追加すると、新しい記事がここに届きます。</p>
      </div>
    </div>;
  }

  return <>
    <div className="space-y-4">{articles.map((article) => <ArticleCard key={article.id} article={article} onUpdate={onUpdate} />)}</div>
    {nextCursor && <div className="mt-7 text-center"><button className="btn btn-outline" onClick={onLoadMore}>さらに読み込む</button></div>}
  </>;
}

/** Renders an article summary and its read, save, and favorite actions. */
function ArticleCard({ article, onUpdate }: { article: Article; onUpdate: ArticleListProps["onUpdate"] }) {
  return <article className={`card border border-base-300 bg-base-100 shadow-sm transition-shadow hover:shadow-md ${article.read ? "opacity-75" : ""}`}>
    <div className="card-body gap-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
        <span className="font-semibold text-primary">{article.sourceTitle}</span>
        <span aria-hidden="true">·</span><time>{formatDate(article.publishedAt ?? article.expiresAt)}</time>
        {!article.read && <span className="badge badge-primary badge-xs">未読</span>}
      </div>
      <a className="link link-hover text-xl font-semibold leading-snug text-base-content" href={article.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (!article.read) onUpdate(article, { read: true }, "既読にしました"); }}>
        {article.title}
      </a>
      {article.author && <p className="text-sm text-base-content/60">{article.author}</p>}
      {article.summary && <p className="line-clamp-3 whitespace-pre-line text-sm leading-6 text-base-content/75">{article.summary}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button className="btn btn-sm btn-ghost" onClick={() => onUpdate(article, { read: !article.read }, article.read ? "未読に戻しました" : "既読にしました")}>
          {article.read ? "未読に戻す" : "既読にする"}
        </button>
        <button className={`btn btn-sm btn-ghost ${article.readLater ? "text-primary" : ""}`} onClick={() => onUpdate(article, { readLater: !article.readLater }, article.readLater ? "保存を解除しました" : "あとで読むに保存しました")}>
          {article.readLater ? "✓ あとで読む" : "あとで読む"}
        </button>
        <button className={`btn btn-sm btn-ghost ${article.starred ? "text-warning" : ""}`} onClick={() => onUpdate(article, { starred: !article.starred }, article.starred ? "お気に入りを解除しました" : "お気に入りに追加しました")}>
          <LuStar className="mr-1" fill={article.starred ? "currentColor" : "none"} />お気に入り
        </button>
        <span className="ml-auto text-xs text-base-content/50">保存期限 {formatDate(article.expiresAt)}</span>
      </div>
    </div>
  </article>;
}
