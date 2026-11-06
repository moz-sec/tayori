import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LuPanelLeftClose, LuPanelLeftOpen, LuRefreshCw } from "react-icons/lu";
import { ArticleList } from "./components/ArticleList";
import { Sidebar } from "./components/Sidebar";
import { getMutationState, request } from "./lib/api-client";
import { startForegroundSync } from "./lib/foreground-sync";
import { loadArticleWindow } from "./lib/article-window";
import { SourceSettingsDialog } from "./components/SourceSettingsDialog";
import { CollectionSettingsDialog } from "./components/CollectionSettingsDialog";
import { parseOpmlFile } from "./lib/opml";
import { importOpmlRows, summarizeImport, type ImportRow } from "./lib/opml-import";
import { humanError } from "./lib/errors";
import { formatDate } from "./lib/format";
import { markArticlesRead, type MarkReadResult } from "./lib/mark-read";
import type { Article, Folder, FolderDialog, ImportOutline, Page, Scope, Source } from "./types";

/** Owns application state and API actions, then composes the main interface. */
export function App() {
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [scope, setScope] = useState<Scope>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const folderMutationRef = useRef(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceDialog, setSourceDialog] = useState<Source | null>(null);
  const [collectionSettingsOpen, setCollectionSettingsOpen] = useState(false);
  const dialogOpenRef = useRef(false);
  useLayoutEffect(() => { dialogOpenRef.current = !!folderDialog || !!sourceDialog || collectionSettingsOpen; }, [folderDialog, sourceDialog, collectionSettingsOpen]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(7);
  const [status, setStatus] = useState<{ activeSources: number; failingSources: number; lastTickAt: string | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const noticeErrorRef = useRef(false);
  useLayoutEffect(() => { noticeErrorRef.current = noticeError; }, [noticeError]);
  const [importItems, setImportItems] = useState<ImportOutline[] | null>(null);
  const [importSummary, setImportSummary] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const importingRef = useRef(false);
  const parsingImportRef = useRef(false);
  const importFileGenerationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const markingReadRef = useRef(false);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
  const selectedArticleIdsRef = useRef<string[]>([]);
  const changeSelection = useCallback((ids: string[]) => {
    selectedArticleIdsRef.current = ids;
    setSelectedArticleIds(ids);
  }, []);
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
  const articleCountRef = useRef(articles.length);
  useLayoutEffect(() => { articleCountRef.current = articles.length; }, [articles.length]);
  useLayoutEffect(() => {
    currentViewRef.current = currentView;
    changeSelection([]);
    ++reloadVersion.current;
    reloadingRef.current = true;
    setReloading(true);
  }, [currentView, changeSelection]);
  useLayoutEffect(() => { loadedViewRef.current = loadedView; }, [loadedView]);

  /** Reloads folders, feeds, account settings, status, and articles in parallel. */
  const reload = useCallback(async (append = false, background = false, clearNotice = true) => {
    const view = `${scope}:${folderId ?? ""}:${sourceId ?? ""}`;
    if (view !== currentViewRef.current) return;
    if (append && (reloadingRef.current || markingReadRef.current || loadedViewRef.current !== view || !nextCursor)) return;
    const version = ++reloadVersion.current;
    const mutationVersion = getMutationState().version;
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
        background ? loadArticleWindow<Article>(articleCountRef.current, (limit, cursor) => {
          const pageQuery = new URLSearchParams(query);
          pageQuery.set("limit", String(limit));
          if (cursor) pageQuery.set("cursor", cursor);
          return request<Page<Article[]>>(`/articles?${pageQuery}`);
        }) : request<Page<Article[]>>(`/articles?${query}`),
      ]);
      if (version !== reloadVersion.current || view !== currentViewRef.current) return;
      if (background && (mutationVersion !== getMutationState().version || dialogOpenRef.current)) return;
      setFolders(folderResult.data);
      setSources(sourceResult.data);
      if (folderId && !folderResult.data.some((folder) => folder.id === folderId)) { setFolderId(null); return; }
      if (sourceId && !sourceResult.data.some((source) => source.id === sourceId && source.status !== "archived")) { setSourceId(null); return; }
      setRetentionDays(me.data.retentionDays);
      setStatus(statusResult.data);
      setArticles((current) => append ? [...current, ...articleResult.data] : articleResult.data);
      if (!append) {
        const visibleIds = new Set(articleResult.data.map((article) => article.id));
        changeSelection(selectedArticleIdsRef.current.filter((id) => visibleIds.has(id)));
      }
      setNextCursor(articleResult.nextCursor ?? null);
      setLoadedView(view);
      if (clearNotice) {
        setNotice("");
        setNoticeError(false);
      }
    } catch (error) {
      if (version !== reloadVersion.current || view !== currentViewRef.current) return;
      if (background && mutationVersion !== getMutationState().version) return;
      if (clearNotice || !noticeErrorRef.current) {
        setNotice(humanError(error));
        setNoticeError(true);
      }
    } finally {
      if (version === reloadVersion.current && view === currentViewRef.current) {
        reloadingRef.current = false;
        setReloading(false);
      }
    }
  }, [scope, folderId, sourceId, nextCursor, changeSelection]);

  useEffect(() => { void reload(false, false, false); }, [scope, folderId, sourceId]);

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
      await latestReload.current();
    } catch (error) { tell(humanError(error), true); }
    finally {
      updatingArticlesRef.current--;
      setUpdatingArticles((count) => count - 1);
    }
  };

  /** Creates or updates a folder from the folder dialog form. */
  const saveFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (folderMutationRef.current) return;
    folderMutationRef.current = true;
    setFolderBusy(true);
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
    finally { folderMutationRef.current = false; setFolderBusy(false); }
  };

  /** Deletes only the folder, retaining its feeds and articles at the parent level. */
  const deleteFolder = async (folder: Folder) => {
    if (folderMutationRef.current) throw new Error("FOLDER_BUSY");
    folderMutationRef.current = true;
    setFolderBusy(true);
    try {
      await request(`/folders/${encodeURIComponent(folder.id)}`, { method: "DELETE" });
      // A read started before the deletion must not restore the old folder tree.
      ++reloadVersion.current;
      setFolderDialog(null);
      setFolders((current) => current.filter((item) => item.id !== folder.id)
        .map((item) => item.parentId === folder.id ? { ...item, parentId: folder.parentId } : item));
      setSources((current) => current.map((source) => source.folderId === folder.id
        ? { ...source, folderId: folder.parentId } : source));
      if (currentViewRef.current.split(":")[1] === folder.id) {
        // Changing the view triggers a guarded reload for its new parent (or all articles).
        setArticles([]);
        setNextCursor(null);
        setLoadedView(null);
        changeSelection([]);
        setFolderId(folder.parentId);
      } else {
        await latestReload.current();
      }
    } finally { folderMutationRef.current = false; setFolderBusy(false); }
  };

  /** Moves a folder within its current sibling group in one atomic server operation. */
  const moveFolder = async (id: string, direction: "up" | "down") => {
    if (folderMutationRef.current) return;
    folderMutationRef.current = true;
    setFolderBusy(true);
    try {
      await request(`/folders/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ direction }) });
      await latestReload.current();
    } catch (error) {
      await latestReload.current();
      tell(humanError(error), true);
    }
    finally { folderMutationRef.current = false; setFolderBusy(false); }
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

  useEffect(() => {
    const stop = startForegroundSync({
      window, document,
      canSync: () => !reloadingRef.current && !markingReadRef.current && updatingArticlesRef.current === 0
        && !importingRef.current && !parsingImportRef.current && !folderMutationRef.current
        && !dialogOpenRef.current && getMutationState().pending === 0,
      sync: () => latestReload.current(false, true, false),
    });
    return () => { stop(); ++reloadVersion.current; };
  }, []);

  /** Updates selection only for the current loaded view, never during a bulk operation. */
  const toggleArticleSelection = (id: string) => {
    if (markingReadRef.current || reloadingRef.current || loadedViewRef.current !== currentViewRef.current) return;
    if (!articles.some((article) => article.id === id)) return;
    const ids = selectedArticleIdsRef.current;
    changeSelection(ids.includes(id) ? ids.filter((selectedId) => selectedId !== id) : [...ids, id]);
  };

  /** Snapshots only selected articles, retaining unconfirmed IDs independently of later selections. */
  const markSelectedRead = async (retry = false) => {
    if (markingReadRef.current || updatingArticlesRef.current > 0) return;
    if (!retry && (reloadingRef.current || loadedViewRef.current !== currentViewRef.current)) return;
    const selectedIds = new Set(selectedArticleIdsRef.current);
    const ids = retry ? markReadResult?.remainingIds ?? [] : [...new Set(articles.filter((article) => selectedIds.has(article.id)).map((article) => article.id))];
    if (!ids.length) return;
    markingReadRef.current = true;
    setMarkingRead(true);
    const previousCompleted = retry ? markReadResult?.completed ?? 0 : 0;
    const previousUpdated = retry ? markReadResult?.updated ?? 0 : 0;
    try {
      const result = await markArticlesRead(ids);
      const completedIds = new Set(ids.slice(0, result.completed));
      changeSelection(selectedArticleIdsRef.current.filter((id) => !completedIds.has(id)));
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
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button ref={refreshButtonRef} className="btn btn-ghost btn-sm" onClick={() => void reload()} aria-label="更新"><LuRefreshCw /><span>更新</span></button>
              <button className="btn btn-outline btn-sm" onClick={() => void markSelectedRead()} disabled={!selectedArticleIds.length || reloading || loadedView !== currentView || markingRead || updatingArticles > 0 || !!markReadResult?.remainingIds.length}>{markingRead ? "既読にしています…" : `選択した記事を既読（${selectedArticleIds.length}件）`}</button>
              <button className="btn btn-ghost btn-sm" disabled={markingRead || !selectedArticleIds.length} onClick={() => { if (!markingReadRef.current) changeSelection([]); }}>選択を解除</button>
            </div>
          </div>

          {notice && <div role="status" className={`alert mb-5 ${noticeError ? "alert-error" : "alert-info"}`}><span>{notice}</span></div>}
          {markReadResult && <div role="status" className={`alert mb-5 ${markReadResult.remainingIds.length ? "alert-error" : "alert-info"}`}>
            <span>選択した記事のうち{markReadResult.updated}件を既読にしました。{markReadResult.completed > markReadResult.updated && `削除済みなどの${markReadResult.completed - markReadResult.updated}件は更新対象外でした。`}{markReadResult.remainingIds.length > 0 && `前回選択した記事（現在の一覧にない記事も含む）のうち、残り${markReadResult.remainingIds.length}件は処理を確認できていません。${humanError(markReadResult.error)}`}</span>
            {markReadResult.remainingIds.length > 0
              ? <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm" disabled={markingRead || updatingArticles > 0} onClick={() => void markSelectedRead(true)}>残り{markReadResult.remainingIds.length}件を再試行</button>
                <button className="btn btn-ghost btn-sm" disabled={markingRead} onClick={() => { if (!markingReadRef.current) setMarkReadResult(null); }}>残りの処理を取り消す</button>
              </div>
              : <button className="btn btn-ghost btn-sm" onClick={() => setMarkReadResult(null)}>閉じる</button>}
          </div>}

          <ArticleList articles={articles} nextCursor={nextCursor} loadMoreDisabled={reloading || markingRead || loadedView !== currentView} updatesDisabled={markingRead} selectedArticleIds={selectedArticleIds} selectionDisabled={reloading || markingRead || loadedView !== currentView} onToggleSelection={toggleArticleSelection} onUpdate={updateArticle} onLoadMore={() => void reload(true)} />
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
        folderBusy={folderBusy}
        importItems={importItems}
        importSummary={importSummary}
        importRows={importRows}
        busy={busy}
        onScopeChange={(nextScope) => { setScope(nextScope); setFolderId(null); setSourceId(null); }}
        onSelectFolder={(id) => { setFolderId(id); setSourceId(null); setScope("all"); }}
        onSelectSource={(id) => { setSourceId(id); setFolderId(null); setScope("all"); }}
        onOpenFolderDialog={(dialog) => { if (!folderMutationRef.current) setFolderDialog(dialog); }}
        onCloseFolderDialog={() => { if (!folderMutationRef.current) setFolderDialog(null); }}
        onSaveFolder={saveFolder}
        onMoveFolder={moveFolder}
        onDeleteFolder={deleteFolder}
        onCreateSource={createSource}
        onToggleSource={toggleSource}
        onOpenSourceDialog={setSourceDialog}
        onOpenCollectionSettings={() => setCollectionSettingsOpen(true)}
        onImportFile={(file) => void handleOpmlFile(file)}
        onImportOpml={() => void importOpml()}
      />
      {collectionSettingsOpen && <CollectionSettingsDialog onClose={() => setCollectionSettingsOpen(false)} />}
      {sourceDialog && <SourceSettingsDialog
        key={sourceDialog.id}
        source={sourceDialog}
        folders={folders}
        onClose={() => setSourceDialog(null)}
        onFallbackFocus={() => refreshButtonRef.current?.focus()}
        onConflict={async () => { await latestReload.current(false, false, false); }}
        onCommitted={async (id, archived) => {
          if (archived) setSourceId((current) => current === id ? null : current);
          await latestReload.current();
        }}
      />}
    </div>
  );
}

/** Returns the heading label for the selected article scope. */
function scopeLabel(scope: Scope): string { return ({ all: "すべての記事", unread: "未読", "read-later": "あとで読む", starred: "お気に入り" })[scope]; }
