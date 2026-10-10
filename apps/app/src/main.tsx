import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Scope = "all" | "unread" | "read-later" | "starred";
interface Folder { id: string; parentId: string | null; name: string; sortOrder: number; unreadCount: number }
interface Source {
  id: string; folderId: string | null; title: string; url: string; status: "active" | "paused" | "archived";
  lastSuccessAt: string | null; errorCode: string | null; consecutiveFailures: number;
}
interface Board { id: string; name: string; sortOrder: number; articleCount: number }
interface Article {
  id: string; sourceId: string; sourceTitle: string; title: string; url: string; author: string | null;
  summary: string | null; publishedAt: string | null; expiresAt: string; read: boolean;
  starred: boolean; readLater: boolean; saved: boolean; version: number;
}
interface Page<T> { data: T; nextCursor?: string | null }
interface ImportOutline { title: string; url: string; siteUrl?: string; folderPath: string[] }

const request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET")) headers.set("Origin", location.origin);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try { code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? code; } catch { /* keep status */ }
    throw new Error(code);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
};

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [scope, setScope] = useState<Scope>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(7);
  const [status, setStatus] = useState<{ activeSources: number; failingSources: number; lastTickAt: string | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [importItems, setImportItems] = useState<ImportOutline[] | null>(null);
  const [importSummary, setImportSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (append = false) => {
    try {
      const query = new URLSearchParams({ scope, limit: "50" });
      if (folderId) query.set("folderId", folderId);
      if (sourceId) query.set("sourceId", sourceId);
      if (boardId) query.set("boardId", boardId);
      if (append && nextCursor) query.set("cursor", nextCursor);
      const [folderResult, sourceResult, boardResult, me, statusResult, articleResult] = await Promise.all([
        request<Page<Folder[]>>("/folders"),
        request<Page<Source[]>>("/sources"),
        request<Page<Board[]>>("/boards"),
        request<Page<{ retentionDays: number }>>("/me"),
        request<Page<{ activeSources: number; failingSources: number; lastTickAt: string | null }>>("/status"),
        request<Page<Article[]>>(`/articles?${query}`),
      ]);
      setFolders(folderResult.data);
      setSources(sourceResult.data);
      setBoards(boardResult.data);
      setRetentionDays(me.data.retentionDays);
      setStatus(statusResult.data);
      setArticles((current) => append ? [...current, ...articleResult.data] : articleResult.data);
      setNextCursor(articleResult.nextCursor ?? null);
      setNotice("");
      setNoticeError(false);
    } catch (error) {
      setNotice(humanError(error));
      setNoticeError(true);
    }
  }, [scope, folderId, sourceId, boardId, nextCursor]);

  useEffect(() => { void reload(); }, [scope, folderId, sourceId, boardId]);

  const tell = (message: string, error = false) => { setNotice(message); setNoticeError(error); };
  const clearFilters = () => { setFolderId(null); setSourceId(null); setBoardId(null); setScope("all"); };

  const updateArticle = async (article: Article, changes: Record<string, unknown>, message: string) => {
    try {
      await request(`/articles/${encodeURIComponent(article.id)}`, {
        method: "PATCH", body: JSON.stringify({ ...changes, expectedVersion: article.version }),
      });
      tell(message);
      await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const createFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await request("/folders", { method: "POST", body: JSON.stringify({ name: values.get("name"), parentId: values.get("parentId") || null }) });
      form.reset(); tell("フォルダを作成しました"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const createBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request("/boards", { method: "POST", body: JSON.stringify({ name: new FormData(form).get("name") }) });
      form.reset(); tell("ボードを作成しました"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await request("/sources", { method: "POST", body: JSON.stringify({
        url: values.get("url"), title: values.get("title") || undefined, folderId: values.get("folderId") || null,
      }) });
      form.reset(); tell("購読先を登録しました。次の収集サイクルで記事を取得します。"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const toggleSource = async (source: Source) => {
    try {
      await request(`/sources/${encodeURIComponent(source.id)}`, {
        method: "PATCH", body: JSON.stringify({ status: source.status === "active" ? "paused" : "active" }),
      });
      await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const importOpml = async () => {
    if (!importItems) return;
    setBusy(true);
    try {
      const folderIds = await ensureFolderPaths(importItems.map((item) => item.folderPath));
      let added = 0;
      let existing = 0;
      for (let offset = 0; offset < importItems.length; offset += 5) {
        const batch = importItems.slice(offset, offset + 5).map((item) => ({
          url: item.url, title: item.title, siteUrl: item.siteUrl,
          folderId: folderIds.get(JSON.stringify(item.folderPath)) ?? null,
        }));
        const result = await request<Page<Array<{ status: string }>>>("/sources/import", {
          method: "POST", body: JSON.stringify({ sources: batch }),
        });
        for (const item of result.data) {
          if (item.status === "added") added++;
          if (item.status === "existing") existing++;
        }
      }
      setImportSummary(`追加 ${added} 件、登録済み ${existing} 件`);
      setImportItems(null);
      tell(`OPMLを取り込みました（追加 ${added} 件、登録済み ${existing} 件）。`);
      await reload();
    } catch (error) { tell(`OPMLを取り込めませんでした。${humanError(error)}`, true); }
    finally { setBusy(false); }
  };

  const markVisibleRead = async () => {
    if (!articles.length) return;
    try {
      await request("/articles/read", { method: "POST", body: JSON.stringify({ articleIds: articles.slice(0, 50).map((article) => article.id), read: true }) });
      tell("表示中の記事を既読にしました"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const heading = boardId ? boards.find((item) => item.id === boardId)?.name
    : sourceId ? sources.find((item) => item.id === sourceId)?.title
      : folderId ? folders.find((item) => item.id === folderId)?.name
        : scopeLabel(scope);

  return (
    <div data-theme="light" className={`drawer min-h-screen bg-base-200 text-base-content ${sidebarOpen ? "lg:drawer-open" : ""}`}>
      <input id="tayori-drawer" type="checkbox" className="drawer-toggle" checked={sidebarOpen} onChange={(event) => setSidebarOpen(event.currentTarget.checked)} />
      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar sticky top-0 z-20 min-h-16 border-b border-base-300 bg-base-100/95 px-4 shadow-sm backdrop-blur sm:px-6">
          <label htmlFor="tayori-drawer" className="btn btn-square btn-ghost drawer-button" aria-label={sidebarOpen ? "メニューを閉じる" : "メニューを開く"} title={sidebarOpen ? "メニューを閉じる" : "メニューを開く"}>☰</label>
          <button className="btn btn-ghost gap-2 px-2 text-lg font-bold" onClick={clearFilters}>
            <span className="tayori-mark">T</span><span>Tayori</span>
          </button>
          <div className="ml-2 hidden text-xs text-base-content/60 sm:block">記事は{retentionDays}日間保存</div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => void reload()} aria-label="更新">↻ <span className="hidden sm:inline">更新</span></button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8 sm:py-9">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">Your reading list</p>
              <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => void markVisibleRead()} disabled={!articles.length}>表示分を既読</button>
          </div>

          {notice && <div role="status" className={`alert mb-5 ${noticeError ? "alert-error" : "alert-info"}`}><span>{notice}</span></div>}

          {articles.length === 0 ? (
            <div className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body items-center py-16 text-center">
                <span className="text-4xl text-primary/60">✉</span>
                <h2 className="card-title mt-2">記事はまだありません</h2>
                <p className="max-w-sm text-base-content/65">購読先を追加すると、新しい記事がここに届きます。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {articles.map((article) => (
                <article key={article.id} className={`card border border-base-300 bg-base-100 shadow-sm transition-shadow hover:shadow-md ${article.read ? "opacity-75" : ""}`}>
                  <div className="card-body gap-3 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
                      <span className="font-semibold text-primary">{article.sourceTitle}</span>
                      <span aria-hidden="true">·</span><time>{formatDate(article.publishedAt ?? article.expiresAt)}</time>
                      {!article.read && <span className="badge badge-primary badge-xs">未読</span>}
                    </div>
                    <a className="link link-hover text-xl font-semibold leading-snug text-base-content" href={article.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (!article.read) void updateArticle(article, { read: true }, "既読にしました"); }}>
                      {article.title}
                    </a>
                    {article.author && <p className="text-sm text-base-content/60">{article.author}</p>}
                    {article.summary && <p className="line-clamp-3 whitespace-pre-line text-sm leading-6 text-base-content/75">{article.summary}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <button className="btn btn-sm btn-ghost" onClick={() => void updateArticle(article, { read: !article.read }, article.read ? "未読に戻しました" : "既読にしました")}>
                        {article.read ? "未読に戻す" : "既読にする"}
                      </button>
                      <button className={`btn btn-sm btn-ghost ${article.readLater ? "text-primary" : ""}`} onClick={() => void updateArticle(article, { readLater: !article.readLater }, article.readLater ? "保存を解除しました" : "あとで読むに保存しました")}>
                        {article.readLater ? "✓ あとで読む" : "あとで読む"}
                      </button>
                      <button className={`btn btn-sm btn-ghost ${article.starred ? "text-warning" : ""}`} onClick={() => void updateArticle(article, { starred: !article.starred }, article.starred ? "お気に入りを解除しました" : "お気に入りに追加しました")}>
                        {article.starred ? "★ お気に入り" : "☆ お気に入り"}
                      </button>
                      {boards.length > 0 && <BoardSave article={article} boards={boards} tell={tell} reload={reload} />}
                      <span className="ml-auto text-xs text-base-content/50">保存期限 {formatDate(article.expiresAt)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {nextCursor && <div className="mt-7 text-center"><button className="btn btn-outline" onClick={() => void reload(true)}>さらに読み込む</button></div>}
        </main>
      </div>

      <div className="drawer-side z-30">
        <label htmlFor="tayori-drawer" aria-label="メニューを閉じる" className="drawer-overlay" />
        <aside className="flex min-h-full w-80 flex-col border-r border-base-300 bg-base-100 px-4 pb-6 pt-5">
          <div className="mb-5 flex items-center justify-between">
            <button className="flex items-center gap-2 px-2 text-left text-lg font-bold" onClick={clearFilters}>
            <span className="tayori-mark">T</span><span>Tayori</span>
            </button>
            <label htmlFor="tayori-drawer" className="btn btn-square btn-ghost btn-sm" aria-label="メニューを閉じる" title="メニューを閉じる">×</label>
          </div>
          <nav aria-label="記事の絞り込み" className="menu menu-sm gap-1 p-0">
            {(["all", "unread", "read-later", "starred"] as Scope[]).map((item) => (
              <li key={item}><button className={scope === item && !folderId && !sourceId && !boardId ? "active" : ""} onClick={() => { setScope(item); setFolderId(null); setSourceId(null); setBoardId(null); }}>
                <span className="w-5 text-center">{scopeIcon(item)}</span>{scopeLabel(item)}
              </button></li>
            ))}
          </nav>

          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">フォルダ</h2></div>
            <div className="menu menu-sm max-h-52 flex-nowrap overflow-y-auto p-0">
              {flattenFolders(folders).map((folder) => <li key={folder.id}><button className={folderId === folder.id ? "active" : ""} style={{ paddingInlineStart: `${12 + folder.depth * 14}px` }} onClick={() => { setFolderId(folder.id); setSourceId(null); setBoardId(null); setScope("all"); }}>
                <span>▱</span><span className="min-w-0 flex-1 truncate">{folder.name}</span>{folder.unreadCount > 0 && <span className="badge badge-sm">{folder.unreadCount}</span>}
              </button></li>)}
            </div>
            <form className="mt-3 space-y-2 rounded-box bg-base-200 p-3" onSubmit={(event) => void createFolder(event)}>
              <p className="text-xs font-semibold">フォルダを追加</p>
              <input className="input input-bordered input-sm w-full" name="name" maxLength={100} placeholder="フォルダ名" required />
              <select className="select select-bordered select-sm w-full" name="parentId" defaultValue=""><option value="">トップレベル</option>{flattenFolders(folders).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}</select>
              <button className="btn btn-primary btn-sm w-full" type="submit">作成</button>
            </form>
          </section>

          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">購読先</h2><a className="link link-hover text-xs" href="/api/v1/subscriptions.opml">OPML出力</a></div>
            <div className="menu menu-sm max-h-56 flex-nowrap overflow-y-auto p-0">
              {sources.filter((source) => source.status !== "archived").map((source) => <li key={source.id}><div className="flex !justify-between gap-1 p-1">
                <button className={`min-w-0 flex-1 truncate !justify-start ${sourceId === source.id ? "active" : ""}`} title={source.title} onClick={() => { setSourceId(source.id); setFolderId(null); setBoardId(null); setScope("all"); }}>{source.title}</button>
                <button className="btn btn-ghost btn-xs" onClick={() => void toggleSource(source)} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? "Ⅱ" : "▶"}</button>
              </div></li>)}
            </div>
            <form className="mt-3 space-y-2 rounded-box bg-base-200 p-3" onSubmit={(event) => void createSource(event)}>
              <p className="text-xs font-semibold">購読先を追加</p>
              <input className="input input-bordered input-sm w-full" name="url" type="url" maxLength={2048} placeholder="https://example.com/feed.xml" required />
              <input className="input input-bordered input-sm w-full" name="title" maxLength={100} placeholder="表示名（任意）" />
              <select className="select select-bordered select-sm w-full" name="folderId" defaultValue=""><option value="">未分類</option>{flattenFolders(folders).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}</select>
              <button className="btn btn-primary btn-sm w-full" type="submit">追加</button>
            </form>
            <div className="mt-3 space-y-2 rounded-box bg-base-200 p-3">
              <p className="text-xs font-semibold">OPMLを読み込む</p>
              <input className="file-input file-input-bordered file-input-xs w-full" type="file" accept=".opml,.xml,text/xml,application/xml" onChange={(event) => void handleOpmlFile(event.currentTarget.files?.[0], setImportItems, setImportSummary, tell)} />
              {importSummary && <p className="text-xs text-base-content/70">{importSummary}</p>}
              {importItems && <><p className="text-xs">{importItems.length}件を確認しました。</p><button className="btn btn-secondary btn-sm w-full" disabled={busy} onClick={() => void importOpml()}>{busy ? <span className="loading loading-spinner loading-xs" /> : "確認して取り込む"}</button></>}
            </div>
          </section>

          <section className="mt-7">
            <div className="mb-2 px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">ボード</h2></div>
            <div className="menu menu-sm p-0">{boards.map((board) => <li key={board.id}><button className={boardId === board.id ? "active" : ""} onClick={() => { setBoardId(board.id); setFolderId(null); setSourceId(null); setScope("all"); }}><span>▤</span>{board.name}<span className="badge badge-sm">{board.articleCount}</span></button></li>)}</div>
            <form className="mt-3 flex gap-2" onSubmit={(event) => void createBoard(event)}>
              <input className="input input-bordered input-sm min-w-0 flex-1" name="name" maxLength={100} placeholder="新しいボード" required />
              <button className="btn btn-outline btn-sm" type="submit">追加</button>
            </form>
          </section>

          <div className="mt-auto pt-8 text-xs leading-5 text-base-content/55" aria-live="polite">
            {status ? <>{`購読 ${status.activeSources}件 · 要確認 ${status.failingSources}件`}{status.lastTickAt && <><br />最終確認 {formatDate(status.lastTickAt)}</>}</> : "状態を取得中…"}
            <br />記事は{retentionDays}日間保存
          </div>
        </aside>
      </div>
    </div>
  );
}

function BoardSave({ article, boards, tell, reload }: { article: Article; boards: Board[]; tell: (message: string, error?: boolean) => void; reload: () => Promise<void> }) {
  const [boardId, setBoardId] = useState("");
  const save = async () => {
    if (!boardId) return;
    try {
      await request(`/boards/${encodeURIComponent(boardId)}/articles/${encodeURIComponent(article.id)}`, { method: "PUT", body: "{}" });
      tell("ボードに追加しました"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };
  return <div className="join"><select aria-label="保存するボード" className="select select-bordered select-sm join-item max-w-40" value={boardId} onChange={(event) => setBoardId(event.target.value)}><option value="">ボードへ保存…</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select><button className="btn btn-sm join-item" disabled={!boardId} onClick={() => void save()}>追加</button></div>;
}

async function handleOpmlFile(file: File | undefined, setItems: (items: ImportOutline[] | null) => void, setSummary: (summary: string) => void, tell: (message: string, error?: boolean) => void) {
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("OPML_FILE_TOO_LARGE");
    const xml = await file.text();
    if (/<!DOCTYPE/i.test(xml)) throw new Error("OPML_DOCTYPE_NOT_ALLOWED");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "opml") throw new Error("INVALID_OPML");
    const body = doc.querySelector("opml > body, body");
    if (!body) throw new Error("INVALID_OPML");
    const items: ImportOutline[] = [];
    const walk = (parent: Element, path: string[], depth: number) => {
      if (depth > 10) throw new Error("OPML_TOO_DEEP");
      for (const outline of Array.from(parent.children).filter((node) => node.localName.toLowerCase() === "outline")) {
        const url = outline.getAttribute("xmlUrl") ?? outline.getAttribute("xmlurl");
        const title = (outline.getAttribute("title") ?? outline.getAttribute("text") ?? "").trim().slice(0, 100);
        if (url) {
          if (/^https?:\/\//i.test(url)) {
            if (items.length >= 200) throw new Error("OPML_FEED_LIMIT");
            items.push({ title, url, siteUrl: outline.getAttribute("htmlUrl") ?? undefined, folderPath: path });
          }
        } else {
          walk(outline, title ? [...path, title] : path, depth + 1);
        }
      }
    };
    walk(body, [], 0);
    setItems(items);
    setSummary(`${items.length}件の購読先を確認しました`);
  } catch (error) { setItems(null); setSummary(""); tell(humanError(error), true); }
}

async function ensureFolderPaths(paths: string[][]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const existing = (await request<Page<Folder[]>>("/folders")).data;
  for (const path of paths) {
    let parentId: string | null = null;
    const accumulated: string[] = [];
    for (const name of path) {
      accumulated.push(name);
      const key = JSON.stringify(accumulated);
      const found = existing.find((folder) => folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase());
      if (found) parentId = found.id;
      else {
        const created: Page<{ id: string }> = await request<Page<{ id: string }>>("/folders", { method: "POST", body: JSON.stringify({ name, parentId }) });
        const createdId: string = created.data.id;
        parentId = createdId;
        existing.push({ id: createdId, parentId: accumulated.length > 1 ? ids.get(JSON.stringify(accumulated.slice(0, -1))) ?? null : null, name, sortOrder: 0, unreadCount: 0 });
      }
      if (parentId) ids.set(key, parentId);
    }
  }
  return ids;
}

function flattenFolders(folders: Folder[]): Array<Folder & { depth: number }> {
  const result: Array<Folder & { depth: number }> = [];
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) { const group = children.get(folder.parentId) ?? []; group.push(folder); children.set(folder.parentId, group); }
  const walk = (parent: string | null, depth: number, ancestors: Set<string>) => {
    for (const folder of children.get(parent) ?? []) {
      if (ancestors.has(folder.id)) continue;
      result.push({ ...folder, depth });
      walk(folder.id, depth + 1, new Set(ancestors).add(folder.id));
    }
  };
  walk(null, 0, new Set());
  return result;
}

function humanError(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, string> = {
    ACCESS_NOT_CONFIGURED: "Cloudflare Access の設定が必要です。",
    AUTHENTICATION_REQUIRED: "認証が必要です。ページを再読み込みしてください。",
    ACCOUNT_NOT_ALLOWED: "このアカウントは利用を許可されていません。",
    INVALID_ACCESS_TOKEN: "認証を確認できませんでした。再度ログインしてください。",
    SOURCE_ALREADY_EXISTS: "この購読先はすでに登録されています。",
    INVALID_FEED_URL: "公開されているHTTP/HTTPSのフィードURLを入力してください。",
    VERSION_CONFLICT: "記事の状態が更新されました。再読み込みしてください。",
    ORIGIN_NOT_ALLOWED: "リクエストの送信元を確認できませんでした。",
    FOLDER_ALREADY_EXISTS: "同じ階層に同名のフォルダがあります。",
    OPML_FEED_LIMIT: "OPMLの購読先は一度に200件までです。",
    INVALID_OPML: "OPMLファイルを読み込めませんでした。",
    OPML_FILE_TOO_LARGE: "OPMLファイルは1MB以下にしてください。",
  };
  return messages[code] ?? `処理に失敗しました（${code}）。`;
}

function scopeLabel(scope: Scope): string { return ({ all: "すべての記事", unread: "未読", "read-later": "あとで読む", starred: "お気に入り" })[scope]; }
function scopeIcon(scope: Scope): string { return ({ all: "▤", unread: "●", "read-later": "◷", starred: "☆" })[scope]; }
function formatDate(value: string | null): string {
  if (!value) return "日時不明";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "日時不明" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

createRoot(document.getElementById("root")!).render(<App />);
