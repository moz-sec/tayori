import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { FolderDialog as FolderDialogModal } from "./FolderDialog";
import {
  LuBookmark,
  LuCircle,
  LuFolder,
  LuPlus,
  LuSettings,
  LuStar,
  LuRss,
  LuChevronDown,
  LuChevronRight,
  LuArrowUp,
  LuArrowDown,
  LuEllipsis,
} from "react-icons/lu";
import { flattenFolders, readExpandedFolders, saveExpandedFolders } from "../lib/folder-tree";
import { formatDate } from "../lib/format";
import { isPlainNavigation, navigationHref } from "../lib/navigation";
import type { Folder, FolderDialog, Scope, Source } from "../types";

interface SidebarProps {
  scope: Scope;
  folderId: string | null;
  sourceId: string | null;
  folders: Folder[];
  sources: Source[];
  status: { activeSources: number; failingSources: number; lastTickAt: string | null } | null;
  retentionDays: number;
  folderDialog: FolderDialog | null;
  folderBusy: boolean;
  onScopeChange: (scope: Scope) => void;
  onSelectFolder: (id: string) => void;
  onSelectSource: (id: string) => void;
  onMoveFolder: (id: string, direction: "up" | "down") => Promise<void>;
  onOpenFolderDialog: (dialog: FolderDialog) => void;
  onCloseFolderDialog: () => void;
  onSaveFolder: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onDeleteFolder: (folder: Folder) => Promise<void>;
  onOpenSourceDialog: (source: Source) => void;
  onOpenCollectionSettings?: () => void;
  onOpenAddSource: () => void;
  onOpenImportOpml: () => void;
}

/** Renders the sidebar navigation, feed management controls, and OPML actions. */
export function Sidebar(props: SidebarProps) {
  const {
    scope,
    folderId,
    sourceId,
    folders,
    sources,
    status,
    retentionDays,
    folderDialog,
    onScopeChange,
    onSelectFolder,
    onSelectSource,
    onOpenFolderDialog,
    onMoveFolder,
    onCloseFolderDialog,
    onSaveFolder,
    onDeleteFolder,
    folderBusy,
    onOpenSourceDialog,
  } = props;
  const [expandedFolders, setExpandedFolders] = useState(readExpandedFolders);
  const [openMenu, setOpenMenu] = useState<"add" | "more" | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !addMenuRef.current?.contains(event.target))
        setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      (openMenu === "add" ? addButtonRef : moreButtonRef).current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openMenu]);
  const movingFolderRef = useRef(false);
  const [movingFolder, setMovingFolder] = useState<string | null>(null);
  useEffect(() => {
    saveExpandedFolders(expandedFolders);
  }, [expandedFolders]);
  const [actionFolderId, setActionFolderId] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (actionFolderId)
      document
        .getElementById(`folder-actions-${actionFolderId}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [actionFolderId]);
  const collapsedFolders = new Set(
    folders.filter((folder) => !expandedFolders.has(folder.id)).map((folder) => folder.id),
  );
  const visibleFolders = flattenFolders(folders, collapsedFolders);
  const toggleFolder = (id: string) =>
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const moveFolder = async (id: string, direction: "up" | "down") => {
    if (movingFolderRef.current || folderBusy) return;
    movingFolderRef.current = true;
    setMovingFolder(id);
    try {
      await onMoveFolder(id, direction);
    } finally {
      movingFolderRef.current = false;
      setMovingFolder(null);
    }
  };

  return (
    <>
      <div className="tayori-sidebar-content">
        <aside className="tayori-sidebar flex min-h-full w-80 flex-col border-r border-base-300 bg-base-100 px-4 pt-5">
          <div className="mb-6 flex shrink-0 items-center px-2 pt-10">
            <span className="text-xl font-semibold tracking-tight" translate="no">
              Tayori
            </span>
          </div>
          <nav aria-label="記事の絞り込み" className="menu menu-sm gap-1 p-0">
            {(["all", "unread", "read-later", "starred"] as Scope[]).map((item) => (
              <li key={item}>
                <a
                  aria-current={scope === item && !folderId && !sourceId ? "page" : undefined}
                  href={navigationHref(
                    { scope: item, folderId: null, sourceId: null },
                    typeof window === "undefined" ? "/" : window.location.href,
                  )}
                  className={scope === item && !folderId && !sourceId ? "active" : ""}
                  onClick={(event) => {
                    if (isPlainNavigation(event)) {
                      event.preventDefault();
                      onScopeChange(item);
                    }
                  }}
                >
                  <span className="flex w-5 justify-center">{scopeIcon(item)}</span>
                  {scopeLabel(item)}
                </a>
              </li>
            ))}
          </nav>

          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2">
              <h2 className="text-xs font-semibold text-base-content/55">購読先</h2>
              <div ref={addMenuRef} className="tayori-add-menu">
                <button
                  ref={moreButtonRef}
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="購読先のその他の操作"
                  aria-expanded={openMenu === "more"}
                  aria-controls="tayori-more-menu"
                  title="購読先のその他の操作"
                  onClick={() => setOpenMenu((open) => (open === "more" ? null : "more"))}
                >
                  <LuEllipsis aria-hidden="true" />
                </button>
                {openMenu === "more" && (
                  <div
                    id="tayori-more-menu"
                    className="tayori-add-menu-options"
                    aria-label="購読先の操作"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        moreButtonRef.current?.focus();
                        props.onOpenImportOpml();
                      }}
                    >
                      <LuRss aria-hidden="true" />
                      OPMLをインポート
                    </button>
                  </div>
                )}
                <button
                  ref={addButtonRef}
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="購読先やフォルダを追加"
                  aria-expanded={openMenu === "add"}
                  aria-controls="tayori-add-menu"
                  title="購読先やフォルダを追加"
                  onClick={() => setOpenMenu((open) => (open === "add" ? null : "add"))}
                >
                  <LuPlus aria-hidden="true" />
                </button>
                {openMenu === "add" && (
                  <div
                    id="tayori-add-menu"
                    className="tayori-add-menu-options"
                    aria-label="追加する項目"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        addButtonRef.current?.focus();
                        onOpenFolderDialog({ mode: "create", parentId: null });
                      }}
                    >
                      <LuFolder aria-hidden="true" />
                      フォルダを作成
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        addButtonRef.current?.focus();
                        props.onOpenAddSource();
                      }}
                    >
                      <LuRss aria-hidden="true" />
                      購読先を追加
                    </button>
                  </div>
                )}
              </div>
            </div>
            <ul className="menu menu-sm max-h-52 w-full flex-nowrap overflow-y-auto p-0">
              {visibleFolders.map((folder) => (
                <li key={folder.id} className="tayori-folder-entry w-full">
                  <div
                    className="tayori-folder-row flex w-full min-w-0 flex-nowrap items-center gap-0.5"
                    style={{ marginInlineStart: `${Math.min(folder.depth * 16, 96)}px` }}
                  >
                    <button
                      className="btn btn-square btn-ghost btn-xs shrink-0"
                      aria-expanded={!collapsedFolders.has(folder.id)}
                      aria-label={`${folder.name}を${collapsedFolders.has(folder.id) ? "展開" : "折りたたむ"}`}
                      onClick={() => toggleFolder(folder.id)}
                    >
                      {collapsedFolders.has(folder.id) ? (
                        <LuChevronRight aria-hidden="true" />
                      ) : (
                        <LuChevronDown aria-hidden="true" />
                      )}
                    </button>
                    <a
                      aria-current={folderId === folder.id ? "page" : undefined}
                      href={navigationHref(
                        { scope: "all", folderId: folder.id, sourceId: null },
                        typeof window === "undefined" ? "/" : window.location.href,
                      )}
                      className={
                        (folderId === folder.id ? "active " : "") +
                        "flex! min-w-0! flex-1! flex-row! flex-nowrap! items-center! justify-start! gap-2! overflow-hidden whitespace-nowrap"
                      }
                      onClick={(event) => {
                        if (isPlainNavigation(event)) {
                          event.preventDefault();
                          onSelectFolder(folder.id);
                        }
                      }}
                    >
                      <LuFolder className="shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
                      {folder.unreadCount > 0 && (
                        <span className="badge badge-sm shrink-0">{folder.unreadCount}</span>
                      )}
                    </a>
                    <button
                      className="btn btn-square btn-ghost btn-xs shrink-0"
                      aria-label={`${folder.name}の操作`}
                      aria-expanded={actionFolderId === folder.id}
                      aria-controls={`folder-actions-${folder.id}`}
                      onClick={() =>
                        setActionFolderId((current) => (current === folder.id ? null : folder.id))
                      }
                    >
                      <LuEllipsis aria-hidden="true" />
                    </button>
                  </div>
                  {actionFolderId === folder.id && (
                    <div
                      id={`folder-actions-${folder.id}`}
                      className="tayori-folder-actions"
                      role="group"
                      aria-label={`${folder.name}の操作`}
                    >
                      <button
                        className="btn btn-ghost btn-xs shrink-0"
                        aria-label={`${folder.name}を上へ移動`}
                        title="同じ親の中で上へ"
                        disabled={
                          folderBusy ||
                          !!movingFolder ||
                          folders.filter((item) => item.parentId === folder.parentId)[0]?.id ===
                            folder.id
                        }
                        onClick={() => void moveFolder(folder.id, "up")}
                      >
                        <LuArrowUp aria-hidden="true" />
                        <span>上へ移動</span>
                      </button>
                      <button
                        className="btn btn-ghost btn-xs shrink-0"
                        aria-label={`${folder.name}を下へ移動`}
                        title="同じ親の中で下へ"
                        disabled={
                          folderBusy ||
                          !!movingFolder ||
                          folders.filter((item) => item.parentId === folder.parentId).at(-1)?.id ===
                            folder.id
                        }
                        onClick={() => void moveFolder(folder.id, "down")}
                      >
                        <LuArrowDown aria-hidden="true" />
                        <span>下へ移動</span>
                      </button>
                      <button
                        className="btn btn-ghost btn-xs shrink-0"
                        aria-label={`「${folder.name}」のフォルダ設定`}
                        title="フォルダ設定"
                        onClick={() => onOpenFolderDialog({ mode: "edit", folder })}
                      >
                        <LuSettings aria-hidden="true" />
                        <span>フォルダ設定</span>
                      </button>
                    </div>
                  )}
                  {!collapsedFolders.has(folder.id) &&
                    sources
                      .filter(
                        (source) => source.folderId === folder.id && source.status !== "archived",
                      )
                      .map((source) => (
                        <SourceItem
                          key={source.id}
                          source={source}
                          depth={folder.depth + 1}
                          selected={sourceId === source.id}
                          onSelect={onSelectSource}
                          onSettings={onOpenSourceDialog}
                        />
                      ))}
                </li>
              ))}
              {sources
                .filter((source) => source.status !== "archived" && !source.folderId)
                .map((source) => (
                  <li key={source.id}>
                    <SourceItem
                      source={source}
                      selected={sourceId === source.id}
                      onSelect={onSelectSource}
                      onSettings={onOpenSourceDialog}
                    />
                  </li>
                ))}
            </ul>
          </section>

          <div className="mt-auto pt-8 text-xs leading-5 text-base-content/55" aria-live="polite">
            {status ? (
              <>
                {`購読 ${status.activeSources}件 · 要確認 ${status.failingSources}件`}
                {status.lastTickAt && (
                  <>
                    <br />
                    収集スケジューラー最終実行 {formatDate(status.lastTickAt)}
                  </>
                )}
              </>
            ) : (
              "状態を取得中…"
            )}
            <br />
            記事は{retentionDays}日間保存
          </div>
          {props.onOpenCollectionSettings && (
            <div className="tayori-sidebar-footer">
              <button
                className="btn btn-square btn-ghost btn-sm text-base-content"
                onClick={props.onOpenCollectionSettings}
                aria-label="設定"
                title="設定"
              >
                <LuSettings aria-hidden="true" />
              </button>
            </div>
          )}
        </aside>
      </div>

      {folderDialog && (
        <FolderDialogModal
          key={
            folderDialog.mode === "edit"
              ? `edit:${folderDialog.folder.id}`
              : `create:${folderDialog.parentId ?? "root"}`
          }
          dialog={folderDialog}
          folders={folders}
          busy={folderBusy}
          onClose={onCloseFolderDialog}
          onSave={onSaveFolder}
          onDelete={onDeleteFolder}
        />
      )}
    </>
  );
}

/** Uses native details so feed diagnostics also work by keyboard and on touch screens. */
function SourceItem({
  source,
  depth = 0,
  selected,
  onSelect,
  onSettings,
}: {
  source: Source;
  depth?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onSettings: (source: Source) => void;
}) {
  return (
    <div
      className="tayori-source-row block! min-w-0 p-1!"
      style={{ marginInlineStart: `${Math.min(depth * 16, 96)}px` }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <a
          aria-current={selected ? "page" : undefined}
          href={navigationHref(
            { scope: "all", folderId: null, sourceId: source.id },
            typeof window === "undefined" ? "/" : window.location.href,
          )}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left ${selected ? "active" : ""}`}
          title={source.errorCode ? `${source.title}（取得エラー）` : source.title}
          onClick={(event) => {
            if (isPlainNavigation(event)) {
              event.preventDefault();
              onSelect(source.id);
            }
          }}
        >
          <span className={`min-w-0 flex-1 truncate ${source.errorCode ? "text-error" : ""}`}>
            {source.title}
            {source.errorCode && <span className="sr-only">（取得エラー）</span>}
          </span>
          <span className="badge badge-sm shrink-0" aria-label={`未読${source.unreadCount}件`}>
            {source.unreadCount}
          </span>
        </a>
        <button
          className="btn btn-square btn-ghost btn-xs shrink-0"
          aria-label={`${source.title}の購読設定`}
          title="購読設定"
          onClick={() => onSettings(source)}
        >
          <LuSettings aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Returns the sidebar label for an article scope. */
function scopeLabel(scope: Scope): string {
  return { all: "すべての記事", unread: "未読", "read-later": "あとで読む", starred: "お気に入り" }[
    scope
  ];
}
/** Returns the navigation icon for an article scope. */
function scopeIcon(scope: Scope) {
  const Icon = { all: LuRss, unread: LuCircle, "read-later": LuBookmark, starred: LuStar }[scope];
  return <Icon aria-hidden="true" />;
}
