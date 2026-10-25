import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LuPanelLeftClose, LuPanelLeftOpen, LuRefreshCw } from "react-icons/lu";
import { ArticleList } from "./components/ArticleList";
import { Sidebar } from "./components/Sidebar";
import { request } from "./lib/api-client";
import { ensureFolderPaths, parseOpmlFile } from "./lib/opml";
import { humanError } from "./lib/errors";
import { formatDate } from "./lib/format";
import type { Article, Folder, FolderDialog, ImportOutline, Page, Scope, Source } from "./types";

/** Owns application state and API actions, then composes the main interface. */
export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [scope, setScope] = useState<Scope>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
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

  /** Reloads folders, feeds, account settings, status, and articles in parallel. */
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

  /** Displays the result of an action in the page notification. */
  const tell = (message: string, error = false) => { setNotice(message); setNoticeError(error); };
  /** Updates an article's read or saved state, then reloads the list. */
  const updateArticle = async (article: Article, changes: Record<string, unknown>, message: string) => {
    try {
      await request(`/articles/${encodeURIComponent(article.id)}`, {
        method: "PATCH", body: JSON.stringify({ ...changes, expectedVersion: article.version }),
      });
      tell(message);
      await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  /** Creates or updates a folder from the folder dialog form. */
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

  /** Creates a feed from the add-feed form. */
  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await request("/sources", { method: "POST", body: JSON.stringify({
        url: values.get("url"), title: values.get("title") || undefined, folderId: values.get("folderId") || null,
      }) });
      form.reset(); tell("購読先を登録しました。記事はバックグラウンドで取得されます。"); await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  /** Pauses or resumes feed polling. */
  const toggleSource = async (source: Source) => {
    try {
      await request(`/sources/${encodeURIComponent(source.id)}`, {
        method: "PATCH", body: JSON.stringify({ status: source.status === "active" ? "paused" : "active" }),
      });
      await reload();
    } catch (error) { tell(humanError(error), true); }
  };

  /** Parses a selected OPML file and stores its feeds for import confirmation. */
  const handleOpmlFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const items = await parseOpmlFile(file);
      setImportItems(items);
      setImportSummary(`${items.length}件の購読先を確認しました`);
    } catch (error) {
      setImportItems(null);
      setImportSummary("");
      tell(humanError(error), true);
    }
  };

  /** Imports the confirmed OPML feeds while preserving their folder hierarchy. */
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

  /** Marks the first 50 currently displayed articles as read. */
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

          <ArticleList articles={articles} nextCursor={nextCursor} onUpdate={updateArticle} onLoadMore={() => void reload(true)} />
        </main>
      </div>

      <Sidebar
        scope={scope}
        folderId={folderId}
        sourceId={sourceId}
        folders={folders}
        sources={sources}
        status={status}
        retentionDays={retentionDays}
        folderDialog={folderDialog}
        importItems={importItems}
        importSummary={importSummary}
        busy={busy}
        onScopeChange={(nextScope) => { setScope(nextScope); setFolderId(null); setSourceId(null); }}
        onSelectFolder={(id) => { setFolderId(id); setSourceId(null); setScope("all"); }}
        onSelectSource={(id) => { setSourceId(id); setFolderId(null); setScope("all"); }}
        onOpenFolderDialog={setFolderDialog}
        onCloseFolderDialog={() => setFolderDialog(null)}
        onSaveFolder={saveFolder}
        onCreateSource={createSource}
        onToggleSource={toggleSource}
        onImportFile={(file) => void handleOpmlFile(file)}
        onImportOpml={() => void importOpml()}
      />
    </div>
  );
}

/** Returns the heading label for the selected article scope. */
function scopeLabel(scope: Scope): string { return ({ all: "すべての記事", unread: "未読", "read-later": "あとで読む", starred: "お気に入り" })[scope]; }
