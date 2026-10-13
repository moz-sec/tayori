import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { LuBookmark, LuCircle, LuFolder, LuMail, LuPanelLeftClose, LuPanelLeftOpen, LuPause, LuPlay, LuPlus, LuRefreshCw, LuRss, LuSettings, LuStar } from "react-icons/lu";
import "./style.css";

type Scope = "all" | "unread" | "read-later" | "starred";
interface Folder { id: string; parentId: string | null; name: string; sortOrder: number; unreadCount: number }
interface Source {
  id: string; folderId: string | null; title: string; url: string; status: "active" | "paused" | "archived";
  lastSuccessAt: string | null; errorCode: string | null; consecutiveFailures: number;
}
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
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create"; parentId: string | null } | { mode: "edit"; folder: Folder } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
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
      if (append && nextCursor) query.set("cursor", nextCursor);
      const [folderResult, sourceResult, me, statusResult, articleResult] = await Promise.all([
        request<Page<Folder[]>>("/folders"),
        request<Page<Source[]>>("/sources"),
        request<Page<{ retentionDays: number }>>("/me"),
        request<Page<{ activeSources: number; failingSources: number; lastTickAt: string | null }>>("/status"),
        request<Page<Article[]>>(`/articles?${query}`),
      ]);
      setFolders(folderResult.data);
      setSources(sourceResult.data);
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
  }, [scope, folderId, sourceId, nextCursor]);

  useEffect(() => { void reload(); }, [scope, folderId, sourceId]);

  const tell = (message: string, error = false) => { setNotice(message); setNoticeError(error); };
  const updateArticle = async (article: Article, changes: Record<string, unknown>, message: string) => {
    try {
      await request(`/articles/${encodeURIComponent(article.id)}`, {
        method: "PATCH", body: JSON.stringify({ ...changes, expectedVersion: article.version }),
      });
      tell(message);
      await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  const saveFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const parentId = values.get("parentId") || null;
      if (folderDialog?.mode === "edit") {
        await request(`/folders/${encodeURIComponent(folderDialog.folder.id)}`, { method: "PATCH", body: JSON.stringify({ name: values.get("name"), parentId }) });
        tell("フォルダ設定を更新しました");
      } else {
        await request("/folders", { method: "POST", body: JSON.stringify({ name: values.get("name"), parentId }) });
        tell("フォルダを作成しました");
      }
      setFolderDialog(null); form.reset(); await reload();
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

  const heading = sourceId ? sources.find((item) => item.id === sourceId)?.title
      : folderId ? folders.find((item) => item.id === folderId)?.name
        : scopeLabel(scope);

  return (
    <div data-theme="light" className="drawer relative min-h-screen bg-base-200 text-base-content">
      <input id="tayori-drawer" type="checkbox" className="drawer-toggle" checked={sidebarOpen} onChange={(event) => setSidebarOpen(event.currentTarget.checked)} />
      <div className="drawer-content flex min-h-screen flex-col">
        <button className="fixed left-4 top-4 z-40 btn btn-square btn-ghost btn-sm bg-base-100/90" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
          {sidebarOpen ? <LuPanelLeftClose /> : <LuPanelLeftOpen />}
        </button>
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 sm:px-12 sm:py-14 lg:px-16">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => void reload()} aria-label="更新"><LuRefreshCw /><span>更新</span></button>
              <button className="btn btn-outline btn-sm" onClick={() => void markVisibleRead()} disabled={!articles.length}>表示分を既読</button>
            </div>
          </div>

          {notice && <div role="status" className={`alert mb-5 ${noticeError ? "alert-error" : "alert-info"}`}><span>{notice}</span></div>}

          {articles.length === 0 ? (
            <div className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body items-center py-16 text-center">
                <LuMail className="text-4xl text-primary/60" aria-hidden="true" />
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
                        <LuStar className="mr-1" fill={article.starred ? "currentColor" : "none"} />お気に入り
                      </button>
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
        <aside className="tayori-sidebar flex min-h-full w-80 flex-col border-r border-base-300/40 bg-base-100 px-4 pb-6 pt-5">
          <div className="h-8 shrink-0" aria-hidden="true" />
          <nav aria-label="記事の絞り込み" className="menu menu-sm gap-1 p-0">
            {(["all", "unread", "read-later", "starred"] as Scope[]).map((item) => (
              <li key={item}><button className={scope === item && !folderId && !sourceId ? "active" : ""} onClick={() => { setScope(item); setFolderId(null); setSourceId(null); }}>
                <span className="flex w-5 justify-center">{scopeIcon(item)}</span>{scopeLabel(item)}
              </button></li>
            ))}
          </nav>

          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">Feeds</h2><button className="btn btn-ghost btn-xs" aria-label="New folder" title="New folder" onClick={() => setFolderDialog({ mode: "create", parentId: null })}><LuPlus /></button></div>
            <ul className="menu menu-sm w-full max-h-52 flex-nowrap overflow-y-auto p-0">
              {flattenFolders(folders).map((folder) => <li key={folder.id} className="w-full">
                <div className="flex w-full min-w-0 flex-nowrap items-center gap-0.5">
                  <button className={(folderId === folder.id ? "active " : "") + "!flex !min-w-0 !flex-1 !flex-row !flex-nowrap !items-center !justify-start !gap-2 overflow-hidden whitespace-nowrap"} style={{ paddingInlineStart: `${12 + folder.depth * 14}px` }} onClick={() => { setFolderId(folder.id); setSourceId(null); setScope("all"); }}>
                    <LuFolder className="shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>{folder.unreadCount > 0 && <span className="badge badge-sm shrink-0">{folder.unreadCount}</span>}
                  </button>
                  <button className="btn btn-square btn-ghost btn-xs shrink-0" aria-label={`Add subfolder to ${folder.name}`} title="Add subfolder" onClick={() => setFolderDialog({ mode: "create", parentId: folder.id })}><LuPlus /></button>
                  <button className="btn btn-square btn-ghost btn-xs shrink-0" aria-label={`Settings for ${folder.name}`} title="Folder settings" onClick={() => setFolderDialog({ mode: "edit", folder })}><LuSettings /></button>
                </div>
                {sources.filter((source) => source.folderId === folder.id && source.status !== "archived").map((source) => <div key={source.id} className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-1 py-0 pl-5">
                  <button className={`!flex min-w-0 flex-1 !flex-row !justify-start truncate whitespace-nowrap ${sourceId === source.id ? "active" : ""}`} title={source.title} onClick={() => { setSourceId(source.id); setFolderId(null); setScope("all"); }}>{source.title}</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => void toggleSource(source)} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? <LuPause /> : <LuPlay />}</button>
                </div>)}
              </li>)}
            </ul>
          </section>

          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">未分類</h2><a className="link link-hover text-xs" href="/api/v1/subscriptions.opml">OPML出力</a></div>
            <div className="menu menu-sm max-h-56 flex-nowrap overflow-y-auto p-0">
              {sources.filter((source) => source.status !== "archived" && !source.folderId).map((source) => <li key={source.id}><div className="flex !justify-between gap-1 p-1">
                <button className={`min-w-0 flex-1 truncate !justify-start ${sourceId === source.id ? "active" : ""}`} title={source.title} onClick={() => { setSourceId(source.id); setFolderId(null); setScope("all"); }}>{source.title}</button>
                <button className="btn btn-ghost btn-xs" onClick={() => void toggleSource(source)} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? <LuPause /> : <LuPlay />}</button>
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

          <div className="mt-auto pt-8 text-xs leading-5 text-base-content/55" aria-live="polite">
            {status ? <>{`購読 ${status.activeSources}件 · 要確認 ${status.failingSources}件`}{status.lastTickAt && <><br />最終確認 {formatDate(status.lastTickAt)}</>}</> : "状態を取得中…"}
            <br />記事は{retentionDays}日間保存
          </div>
        </aside>
      </div>
      {folderDialog && <dialog open className="modal modal-open z-50" aria-labelledby="folder-dialog-title">
        <div className="modal-box">
          <h2 id="folder-dialog-title" className="mb-4 text-lg font-bold">{folderDialog.mode === "create" ? "New folder" : "Folder settings"}</h2>
          <form className="space-y-4" onSubmit={(event) => void saveFolder(event)}>
            <label className="form-control w-full">
              <span className="label-text mb-1">Folder name</span>
              <input className="input input-bordered w-full" name="name" maxLength={100} defaultValue={folderDialog.mode === "edit" ? folderDialog.folder.name : ""} placeholder="Folder name" required autoFocus />
            </label>
            <label className="form-control w-full">
              <span className="label-text mb-1">Parent folder</span>
              <select className="select select-bordered w-full" name="parentId" defaultValue={folderDialog.mode === "create" ? folderDialog.parentId ?? "" : folderDialog.folder.parentId ?? ""}>
                <option value="">Top level</option>
                {flattenFolders(folders).filter((folder) => folderDialog.mode === "create" || folder.id !== folderDialog.folder.id).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}
              </select>
            </label>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => setFolderDialog(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{folderDialog.mode === "create" ? "Create" : "Save"}</button>
            </div>
          </form>
        </div>
      </dialog>}
    </div>
  );
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
function scopeIcon(scope: Scope) {
  const Icon = ({ all: LuRss, unread: LuCircle, "read-later": LuBookmark, starred: LuStar })[scope];
  return <Icon aria-hidden="true" />;
}
function formatDate(value: string | null): string {
  if (!value) return "日時不明";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "日時不明" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

createRoot(document.getElementById("root")!).render(<App />);
