import type { FormEvent } from "react";
import type { ImportRow } from "../lib/opml-import";
import { LuBookmark, LuCircle, LuFolder, LuPause, LuPlay, LuPlus, LuSettings, LuStar, LuRss } from "react-icons/lu";
import { formatDate } from "../lib/format";
import { feedErrorMessage } from "../lib/feed-status";
import type { Folder, FolderDialog, ImportOutline, Scope, Source } from "../types";

interface SidebarProps {
  scope: Scope;
  folderId: string | null;
  sourceId: string | null;
  folders: Folder[];
  sources: Source[];
  status: { activeSources: number; failingSources: number; lastTickAt: string | null } | null;
  retentionDays: number;
  folderDialog: FolderDialog | null;
  importItems: ImportOutline[] | null;
  importSummary: string;
  importRows: ImportRow[];
  busy: boolean;
  onScopeChange: (scope: Scope) => void;
  onSelectFolder: (id: string) => void;
  onSelectSource: (id: string) => void;
  onOpenFolderDialog: (dialog: FolderDialog) => void;
  onCloseFolderDialog: () => void;
  onSaveFolder: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSource: (event: FormEvent<HTMLFormElement>) => void;
  onToggleSource: (source: Source) => void;
  onImportFile: (file: File | undefined) => void;
  onImportOpml: () => void;
}

/** Renders the sidebar navigation, feed management controls, and OPML actions. */
export function Sidebar(props: SidebarProps) {
  const {
    scope, folderId, sourceId, folders, sources, status, retentionDays, folderDialog, importItems,
    importSummary, importRows, busy, onScopeChange, onSelectFolder, onSelectSource, onOpenFolderDialog,
    onCloseFolderDialog, onSaveFolder, onCreateSource, onToggleSource, onImportFile, onImportOpml,
  } = props;
  const flatFolders = flattenFolders(folders);

  return <>
    <div className="drawer-side z-30">
      <aside className="tayori-sidebar flex min-h-full w-80 flex-col border-r border-base-300/40 bg-base-100 px-4 pb-6 pt-5">
        <div className="h-8 shrink-0" aria-hidden="true" />
        <nav aria-label="記事の絞り込み" className="menu menu-sm gap-1 p-0">
          {(["all", "unread", "read-later", "starred"] as Scope[]).map((item) => <li key={item}>
            <button className={scope === item && !folderId && !sourceId ? "active" : ""} onClick={() => onScopeChange(item)}>
              <span className="flex w-5 justify-center">{scopeIcon(item)}</span>{scopeLabel(item)}
            </button>
          </li>)}
        </nav>

        <section className="mt-7">
          <div className="mb-2 flex items-center justify-between px-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">Feeds</h2>
            <button className="btn btn-ghost btn-xs" aria-label="New folder" title="New folder" onClick={() => onOpenFolderDialog({ mode: "create", parentId: null })}><LuPlus /></button>
          </div>
          <ul className="menu menu-sm max-h-52 w-full flex-nowrap overflow-y-auto p-0">
            {flatFolders.map((folder) => <li key={folder.id} className="w-full">
              <div className="flex w-full min-w-0 flex-nowrap items-center gap-0.5">
                <button className={(folderId === folder.id ? "active " : "") + "flex! min-w-0! flex-1! flex-row! flex-nowrap! items-center! justify-start! gap-2! overflow-hidden whitespace-nowrap"} style={{ paddingInlineStart: `${12 + folder.depth * 14}px` }} onClick={() => onSelectFolder(folder.id)}>
                  <LuFolder className="shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>{folder.unreadCount > 0 && <span className="badge badge-sm shrink-0">{folder.unreadCount}</span>}
                </button>
                <button className="btn btn-square btn-ghost btn-xs shrink-0" aria-label={`Add subfolder to ${folder.name}`} title="Add subfolder" onClick={() => onOpenFolderDialog({ mode: "create", parentId: folder.id })}><LuPlus /></button>
                <button className="btn btn-square btn-ghost btn-xs shrink-0" aria-label={`Settings for ${folder.name}`} title="Folder settings" onClick={() => onOpenFolderDialog({ mode: "edit", folder })}><LuSettings /></button>
              </div>
              {sources.filter((source) => source.folderId === folder.id && source.status !== "archived").map((source) => <SourceItem key={source.id} source={source} selected={sourceId === source.id} onSelect={onSelectSource} onToggle={onToggleSource} />)}
            </li>)}
          </ul>
        </section>

        <section className="mt-7">
          <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">未分類</h2><a className="link link-hover text-xs" href="/api/v1/subscriptions.opml">OPML出力</a></div>
          <div className="menu menu-sm max-h-56 flex-nowrap overflow-y-auto p-0">
            {sources.filter((source) => source.status !== "archived" && !source.folderId).map((source) => <li key={source.id}><SourceItem source={source} selected={sourceId === source.id} onSelect={onSelectSource} onToggle={onToggleSource} /></li>)}
          </div>
          <form className="mt-3 space-y-2 rounded-box bg-base-200 p-3" onSubmit={onCreateSource}>
            <p className="text-xs font-semibold">購読先を追加</p>
            <input className="input input-bordered input-sm w-full" name="url" type="url" maxLength={2048} placeholder="https://example.com/feed.xml" required />
            <input className="input input-bordered input-sm w-full" name="title" maxLength={100} placeholder="表示名（任意）" />
            <select className="select select-bordered select-sm w-full" name="folderId" defaultValue=""><option value="">未分類</option>{flatFolders.map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}</select>
            <button className="btn btn-primary btn-sm w-full" type="submit">追加</button>
          </form>
          <div className="mt-3 space-y-2 rounded-box bg-base-200 p-3">
            <p className="text-xs font-semibold">OPMLを読み込む</p>
            <input className="file-input file-input-bordered file-input-xs w-full" type="file" disabled={busy} accept=".opml,.xml,text/xml,application/xml" onChange={(event) => onImportFile(event.currentTarget.files?.[0])} />
            {importSummary && <p role="status" className="text-xs text-base-content/70">{importSummary}</p>}
            {importRows.some((row) => row.status === "error" || row.status === "pending") && <ul className="max-h-56 space-y-2 overflow-y-auto text-xs" aria-label="OPML取り込みの未完了項目">
              {importRows.map((row, index) => row.status === "error" || row.status === "pending" ? <li key={index} className="break-all">
                <span className="font-semibold">{row.status === "error" ? "失敗" : "未処理"}</span> {row.outline.url}
                {row.error && <p>{row.error}</p>}
              </li> : null)}
            </ul>}
            {!!importItems?.length && <><p className="text-xs">対象 {importItems.length}件</p><button className="btn btn-secondary btn-sm w-full" disabled={busy} onClick={onImportOpml}>{busy ? <span className="loading loading-spinner loading-xs" /> : importRows.some((row) => row.status !== "pending") ? "失敗・未処理分を再試行" : "確認して取り込む"}</button></>}
          </div>
        </section>

        <div className="mt-auto pt-8 text-xs leading-5 text-base-content/55" aria-live="polite">
          {status ? <>{`購読 ${status.activeSources}件 · 要確認 ${status.failingSources}件`}{status.lastTickAt && <><br />収集スケジューラー最終実行 {formatDate(status.lastTickAt)}</>}</> : "状態を取得中…"}
          <br />全体の実行時刻は各フィードの取得完了を示しません。
          <br />記事は{retentionDays}日間保存
        </div>
      </aside>
    </div>

    {folderDialog && <dialog open className="modal modal-open z-50" aria-labelledby="folder-dialog-title">
      <div className="modal-box">
        <h2 id="folder-dialog-title" className="mb-4 text-lg font-bold">{folderDialog.mode === "create" ? "New folder" : "Folder settings"}</h2>
        <form className="space-y-4" onSubmit={onSaveFolder}>
          <label className="form-control w-full">
            <span className="label-text mb-1">Folder name</span>
            <input className="input input-bordered w-full" name="name" maxLength={100} defaultValue={folderDialog.mode === "edit" ? folderDialog.folder.name : ""} placeholder="Folder name" required autoFocus />
          </label>
          <label className="form-control w-full">
            <span className="label-text mb-1">Parent folder</span>
            <select className="select select-bordered w-full" name="parentId" defaultValue={folderDialog.mode === "create" ? folderDialog.parentId ?? "" : folderDialog.folder.parentId ?? ""}>
              <option value="">Top level</option>
              {flatFolders.filter((folder) => folderDialog.mode === "create" || folder.id !== folderDialog.folder.id).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}
            </select>
          </label>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onCloseFolderDialog}>Cancel</button>
            <button type="submit" className="btn btn-primary">{folderDialog.mode === "create" ? "Create" : "Save"}</button>
          </div>
        </form>
      </div>
    </dialog>}
  </>;
}

/** Uses native details so feed diagnostics also work by keyboard and on touch screens. */
function SourceItem({ source, selected, onSelect, onToggle }: {
  source: Source;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (source: Source) => void;
}) {
  return <div className="block! w-full min-w-0 p-1!">
    <div className="flex min-w-0 items-center gap-1">
      <button className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left ${selected ? "active" : ""}`} title={source.title} onClick={() => onSelect(source.id)}>
        <span className="min-w-0 flex-1 truncate">{source.title}</span>
        <span className="badge badge-sm shrink-0" aria-label={`未読${source.unreadCount}件`}>{source.unreadCount}</span>
      </button>
      <button className="btn btn-ghost btn-xs shrink-0" onClick={() => onToggle(source)} aria-label={`${source.title}を${source.status === "active" ? "一時停止" : "再開"}`} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? <LuPause /> : <LuPlay />}</button>
    </div>
    <details className="px-2 text-xs leading-5">
      <summary className={`cursor-pointer ${source.errorCode ? "text-error" : "text-base-content/60"}`}>
        {source.status === "paused" ? "一時停止中" : source.errorCode ? "取得エラー" : source.lastCheckedAt ? "定期収集が有効" : "初回取得の確認待ち"} · 取得状況
      </summary>
      <dl className="mt-1 break-words text-base-content/70">
        <dt>状態</dt><dd>{source.status === "paused" ? "一時停止中（自動取得しません）" : "定期収集が有効"}</dd>
        <dt>最終確認（成功・失敗を含む）</dt><dd>{source.lastCheckedAt ? formatDate(source.lastCheckedAt) : "まだ確認していません"}</dd>
        <dt>最終成功（更新なしを含む）</dt><dd>{source.lastSuccessAt ? formatDate(source.lastSuccessAt) : "まだ成功していません"}</dd>
        <dt>次回対象時刻</dt><dd>{source.status === "paused" ? "停止中のため対象外" : formatDate(source.nextFetchAt)}</dd>
        <dt>連続失敗</dt><dd>{source.consecutiveFailures}回</dd>
        {source.errorCode && <><dt>取得エラー</dt><dd className="text-error">{feedErrorMessage(source.errorCode)}<br /><span className="break-all">コード: {source.errorCode}</span></dd></>}
      </dl>
      {source.status === "active" && <p className="mt-1 text-base-content/60">次回対象時刻は取得完了時刻ではありません。毎時の収集処理・待機状況により遅れることがあります。</p>}
    </details>
  </div>;
}

/** Flattens the folder tree into display order while retaining each folder's depth. */
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

/** Returns the sidebar label for an article scope. */
function scopeLabel(scope: Scope): string { return ({ all: "すべての記事", unread: "未読", "read-later": "あとで読む", starred: "お気に入り" })[scope]; }
/** Returns the navigation icon for an article scope. */
function scopeIcon(scope: Scope) {
  const Icon = ({ all: LuRss, unread: LuCircle, "read-later": LuBookmark, starred: LuStar })[scope];
  return <Icon aria-hidden="true" />;
}
