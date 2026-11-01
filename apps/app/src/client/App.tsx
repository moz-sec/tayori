import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LuPanelLeftClose, LuPanelLeftOpen, LuRefreshCw } from "react-icons/lu";
import { ArticleList } from "./components/ArticleList";
import { Sidebar } from "./components/Sidebar";
import { request } from "./lib/api-client";
import { parseOpmlFile } from "./lib/opml";
import { importOpmlRows, summarizeImport, type ImportRow } from "./lib/opml-import";
import { humanError } from "./lib/errors";
import { formatDate } from "./lib/format";
import { markArticlesRead, type MarkReadResult } from "./lib/mark-read";
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
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const importingRef = useRef(false);
  const parsingImportRef = useRef(false);
  const importFileGenerationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const markingReadRef = useRef(false);
  const [updatingArticles, setUpdatingArticles] = useState(0);
  const updatingArticlesRef = useRef(0);
  const [markReadResult, setMarkReadResult] = useState<MarkReadResult | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);
  const [loadedView, setLoadedView] = useState<string | null>(null);
  const loadedViewRef = useRef<string | null>(null);
  const reloadVersion = useRef(0);
  const currentView = `${scope}:${folderId ?? ""}:${sourceId ?? ""}`;
  const currentViewRef = useRef(currentView);
  useLayoutEffect(() => {
    currentViewRef.current = currentView;
    ++reloadVersion.current;
    reloadingRef.current = true;
    setReloading(true);
  }, [currentView]);
  useLayoutEffect(() => { loadedViewRef.current = loadedView; }, [loadedView]);

  /** Reloads folders, feeds, account settings, status, and articles in parallel. */
  const reload = useCallback(async (append = false) => {
    const view = `${scope}:${folderId ?? ""}:${sourceId ?? ""}`;
    if (view !== currentViewRef.current) return;
    if (append && (reloadingRef.current || markingReadRef.current || loadedViewRef.current !== view || !nextCursor)) return;
    const version = ++reloadVersion.current;
    reloadingRef.current = true;
    setReloading(true);
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
      if (version !== reloadVersion.current || view !== currentViewRef.current) return;
      setFolders(folderResult.data);
      setSources(sourceResult.data);
      setRetentionDays(me.data.retentionDays);
      setStatus(statusResult.data);
      setArticles((current) => append ? [...current, ...articleResult.data] : articleResult.data);
      setNextCursor(articleResult.nextCursor ?? null);
      setLoadedView(view);
      setNotice("");
      setNoticeError(false);
    } catch (error) {
      if (version !== reloadVersion.current || view !== currentViewRef.current) return;
      setNotice(humanError(error));
      setNoticeError(true);
    } finally {
      if (version === reloadVersion.current && view === currentViewRef.current) {
        reloadingRef.current = false;
        setReloading(false);
      }
    }
  }, [scope, folderId, sourceId, nextCursor]);

  useEffect(() => { void reload(); }, [scope, folderId, sourceId]);

  /** Displays the result of an action in the page notification. */
  const tell = (message: string, error = false) => { setNotice(message); setNoticeError(error); };
  /** Updates an article's read or saved state, then reloads the list. */
  const updateArticle = async (article: Article, changes: Record<string, unknown>, message: string) => {
    if (markingReadRef.current) return;
    updatingArticlesRef.current++;
    setUpdatingArticles((count) => count + 1);
    try {
      await request(`/articles/${encodeURIComponent(article.id)}`, {
        method: "PATCH", body: JSON.stringify({ ...changes, expectedVersion: article.version }),
      });
      tell(message);
      await reload();
    } catch (error) { tell(humanError(error), true); }
    finally {
      updatingArticlesRef.current--;
      setUpdatingArticles((count) => count - 1);
    }
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
    if (!file || importingRef.current) return;
    const generation = ++importFileGenerationRef.current;
    parsingImportRef.current = true;
    setImportItems(null);
    setImportRows([]);
    setImportSummary("OPMLを確認中…");
    try {
      const items = await parseOpmlFile(file);
      if (generation !== importFileGenerationRef.current) return;
      setImportItems(items);
      setImportRows(items.map((outline) => ({ outline, status: "pending" })));
      setImportSummary(`${items.length}件の購読先を確認しました`);
    } catch (error) {
      if (generation !== importFileGenerationRef.current) return;
      setImportItems(null);
      setImportRows([]);
      setImportSummary("");
      tell(humanError(error), true);
    } finally {
      if (generation === importFileGenerationRef.current) parsingImportRef.current = false;
    }
  };

  /** Imports confirmed feeds and retains failed or unprocessed entries for retry. */
  const importOpml = async () => {
    if (!importItems?.length || importingRef.current || parsingImportRef.current) return;
    importingRef.current = true;
    setBusy(true);
    try {
      const result = await importOpmlRows(importRows, (rows) => {
        setImportRows(rows);
        setImportSummary(summarizeImport(rows));
      });
      const remaining = result.rows.filter((row) => row.status === "pending" || row.status === "error");
      setImportRows(result.rows);
      setImportItems(remaining.length ? remaining.map((row) => row.outline) : null);
      setImportSummary(`${remaining.length ? "取り込みは未完了です。" : "すべて取り込みました。"}${summarizeImport(result.rows)}${result.interrupted ? `。${result.interrupted}` : ""}`);
      await reload();
    } finally {
      importingRef.current = false;
      setBusy(false);
    }
  };

  const latestReload = useRef(reload);
  useLayoutEffect(() => { latestReload.current = reload; }, [reload]);

  /** Uses a fixed snapshot, retaining unconfirmed IDs independently of pagination. */
  const markVisibleRead = async (retry = false) => {
    if (markingReadRef.current || updatingArticlesRef.current > 0) return;
    if (!retry && (reloadingRef.current || loadedViewRef.current !== currentViewRef.current)) return;
    const ids = retry ? markReadResult?.remainingIds ?? [] : articles.map((article) => article.id);
    if (!ids.length) return;
    markingReadRef.current = true;
    setMarkingRead(true);
    const previousCompleted = retry ? markReadResult?.completed ?? 0 : 0;
    const previousUpdated = retry ? markReadResult?.updated ?? 0 : 0;
    try {
      const result = await markArticlesRead(ids);
      setMarkReadResult({ ...result, completed: previousCompleted + result.completed, updated: previousUpdated + result.updated });
      await latestReload.current();
    } finally {
      markingReadRef.current = false;
      setMarkingRead(false);
    }
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
              <button className="btn btn-outline btn-sm" onClick={() => void markVisibleRead()} disabled={!articles.length || reloading || loadedView !== currentView || markingRead || updatingArticles > 0 || !!markReadResult?.remainingIds.length}>{markingRead ? "既読にしています…" : "表示分を既読"}</button>
            </div>
          </div>

          {notice && <div role="status" className={`alert mb-5 ${noticeError ? "alert-error" : "alert-info"}`}><span>{notice}</span></div>}
          {markReadResult && <div role="status" className={`alert mb-5 ${markReadResult.remainingIds.length ? "alert-error" : "alert-info"}`}>
            <span>{markReadResult.updated}件を既読にしました。{markReadResult.completed > markReadResult.updated && `削除済みなどの${markReadResult.completed - markReadResult.updated}件は更新対象外でした。`}{markReadResult.remainingIds.length > 0 && `操作開始時の記事のうち、残り${markReadResult.remainingIds.length}件は処理を確認できていません。${humanError(markReadResult.error)}`}</span>
            {markReadResult.remainingIds.length > 0
              ? <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm" disabled={markingRead || updatingArticles > 0} onClick={() => void markVisibleRead(true)}>残り{markReadResult.remainingIds.length}件を再試行</button>
                <button className="btn btn-ghost btn-sm" disabled={markingRead} onClick={() => { if (!markingReadRef.current) setMarkReadResult(null); }}>残りの処理を取り消す</button>
              </div>
              : <button className="btn btn-ghost btn-sm" onClick={() => setMarkReadResult(null)}>閉じる</button>}
          </div>}

          <ArticleList articles={articles} nextCursor={nextCursor} loadMoreDisabled={reloading || markingRead || loadedView !== currentView} updatesDisabled={markingRead} onUpdate={updateArticle} onLoadMore={() => void reload(true)} />
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
        importRows={importRows}
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
