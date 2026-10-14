import type { FormEvent } from "react";
import { LuBookmark, LuCircle, LuFolder, LuPause, LuPlay, LuPlus, LuSettings, LuStar, LuRss } from "react-icons/lu";
import { formatDate } from "../lib/format";
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
    importSummary, busy, onScopeChange, onSelectFolder, onSelectSource, onOpenFolderDialog,
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
              {sources.filter((source) => source.folderId === folder.id && source.status !== "archived").map((source) => <div key={source.id} className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-1 py-0 pl-5">
                <button className={`flex! min-w-0 flex-1 flex-row! justify-start! truncate whitespace-nowrap ${sourceId === source.id ? "active" : ""}`} title={source.title} onClick={() => onSelectSource(source.id)}>{source.title}</button>
                <button className="btn btn-ghost btn-xs" onClick={() => onToggleSource(source)} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? <LuPause /> : <LuPlay />}</button>
              </div>)}
            </li>)}
          </ul>
        </section>

        <section className="mt-7">
          <div className="mb-2 flex items-center justify-between px-2"><h2 className="text-xs font-bold uppercase tracking-wider text-base-content/55">未分類</h2><a className="link link-hover text-xs" href="/api/v1/subscriptions.opml">OPML出力</a></div>
          <div className="menu menu-sm max-h-56 flex-nowrap overflow-y-auto p-0">
            {sources.filter((source) => source.status !== "archived" && !source.folderId).map((source) => <li key={source.id}><div className="flex justify-between! gap-1 p-1">
              <button className={`min-w-0 flex-1 truncate justify-start! ${sourceId === source.id ? "active" : ""}`} title={source.title} onClick={() => onSelectSource(source.id)}>{source.title}</button>
              <button className="btn btn-ghost btn-xs" onClick={() => onToggleSource(source)} title={source.status === "active" ? "一時停止" : "再開"}>{source.status === "active" ? <LuPause /> : <LuPlay />}</button>
            </div></li>)}
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
            <input className="file-input file-input-bordered file-input-xs w-full" type="file" accept=".opml,.xml,text/xml,application/xml" onChange={(event) => onImportFile(event.currentTarget.files?.[0])} />
            {importSummary && <p className="text-xs text-base-content/70">{importSummary}</p>}
            {importItems && <><p className="text-xs">{importItems.length}件を確認しました。</p><button className="btn btn-secondary btn-sm w-full" disabled={busy} onClick={onImportOpml}>{busy ? <span className="loading loading-spinner loading-xs" /> : "確認して取り込む"}</button></>}
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
