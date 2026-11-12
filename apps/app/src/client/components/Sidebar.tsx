import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { normalizeFeedUrl } from "@tayori/shared";
import { MoveItemDialog, type MoveItem } from "./MoveItemDialog";
import { humanError } from "../lib/errors";
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
  onRelocateItem: (kind: "folder" | "source", id: string, parentId: string | null) => Promise<void>;
  onOpenFolderDialog: (dialog: FolderDialog) => void;
  onCloseFolderDialog: () => void;
  onSaveFolder: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onDeleteFolder: (folder: Folder) => Promise<void>;
  onOpenSourceDialog: (source: Source) => void;
  onOpenCollectionSettings?: () => void;
  onOpenAddSource: () => void;
  onOpenImportOpml: () => void;
}

type MoveHandlers = {
  [
    K in
      | "onPointerDown"
      | "onPointerMove"
      | "onPointerUp"
      | "onPointerCancel"
      | "onContextMenu"
      | "onKeyDown"
      | "onDragStart"
  ]: import("react").ComponentProps<"a">[K];
};

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
    onRelocateItem,
    onCloseFolderDialog,
    onSaveFolder,
    onDeleteFolder,
    folderBusy,
    onOpenSourceDialog,
  } = props;
  const [moveDialog, setMoveDialog] = useState<MoveItem | null>(null);
  const [dragItem, setDragItem] = useState<MoveItem | null>(null);
  const [dragError, setDragError] = useState("");
  const pressRef = useRef<{
    item: MoveItem;
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
    scrolling: boolean;
    lastY: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(
    () => () => {
      if (pressRef.current) clearTimeout(pressRef.current.timer);
    },
    [],
  );
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "inside" | "before" | "after";
  } | null>(null);
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

  const dropInto = async (moving: MoveItem, target: string | null) => {
    if (folderBusy) return;
    setDragError("");
    const current = moving.kind === "folder" ? moving.item.parentId : moving.item.folderId;
    if (current === target) return;
    try {
      await onRelocateItem(moving.kind, moving.item.id, target);
    } catch (error) {
      setDragError(humanError(error));
    }
  };

  const targetAt = (moving: MoveItem, x: number, y: number) => {
    const element = document.elementFromPoint(x, y);
    if (element?.closest(".tayori-drop-root")) return { id: "", position: "inside" as const };
    const row = element?.closest<HTMLElement>(".tayori-folder-row");
    const folder = folders.find((item) => item.id === row?.dataset.folderId);
    if (!row || !folder) return null;
    const rect = row.getBoundingClientRect();
    const fraction = (y - rect.top) / rect.height;
    const canOrder =
      moving.kind === "folder" &&
      moving.item.parentId === folder.parentId &&
      moving.item.id !== folder.id;
    return {
      id: folder.id,
      position:
        canOrder && fraction < 0.25
          ? ("before" as const)
          : canOrder && fraction > 0.75
            ? ("after" as const)
            : ("inside" as const),
    };
  };

  const finishMove = async (moving: MoveItem, target: ReturnType<typeof targetAt>) => {
    if (!target) return;
    if (!target.id) return dropInto(moving, null);
    const folder = folders.find((item) => item.id === target.id);
    if (!folder) return;
    if (moving.kind === "folder" && target.position !== "inside") {
      const siblings = folders.filter((item) => item.parentId === folder.parentId);
      const oldIndex = siblings.findIndex((item) => item.id === moving.item.id);
      const targetIndex = siblings.findIndex((item) => item.id === folder.id);
      const newIndex =
        targetIndex + (target.position === "after" ? 1 : 0) - (oldIndex < targetIndex ? 1 : 0);
      const direction = newIndex < oldIndex ? "up" : "down";
      try {
        for (let i = 0; i < Math.abs(newIndex - oldIndex); i++)
          await onMoveFolder(moving.item.id, direction);
      } catch (error) {
        setDragError(humanError(error));
      }
      return;
    }
    if (moving.kind === "folder" && moving.item.id === folder.id) {
      setMoveDialog(moving);
      return;
    }
    await dropInto(moving, folder.id);
  };

  const moveHandlers = (item: MoveItem) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLAnchorElement>) => {
      if (folderBusy || event.button !== 0 || !event.isPrimary) return;
      if (pressRef.current) clearTimeout(pressRef.current.timer);
      const anchor = event.currentTarget;
      const press = {
        item,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
        scrolling: false,
        lastY: event.clientY,
        timer: setTimeout(() => {
          if (pressRef.current !== press) return;
          press.active = true;
          suppressClick.current = true;
          setDragError("");
          setDragItem(item);
        }, 500),
      };
      pressRef.current = press;
      anchor.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLAnchorElement>) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (
        !press.active &&
        (press.scrolling || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8)
      ) {
        clearTimeout(press.timer);
        if (event.pointerType === "touch") {
          press.scrolling = true;
          suppressClick.current = true;
          const panel = event.currentTarget.closest<HTMLElement>(".tayori-sidebar-panel");
          if (panel) panel.scrollTop += press.lastY - event.clientY;
          press.lastY = event.clientY;
        } else {
          press.active = true;
          suppressClick.current = true;
          setDragError("");
          setDragItem(press.item);
          setDropTarget(targetAt(press.item, event.clientX, event.clientY));
          event.preventDefault();
        }
        return;
      }
      if (press.active) {
        event.preventDefault();
        setDropTarget(targetAt(press.item, event.clientX, event.clientY));
      }
    },
    onPointerUp: (event: ReactPointerEvent<HTMLAnchorElement>) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      clearTimeout(press.timer);
      pressRef.current = null;
      if (!press.active) {
        if (press.scrolling)
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
        return;
      }
      event.preventDefault();
      const target = targetAt(press.item, event.clientX, event.clientY);
      setDragItem(null);
      setDropTarget(null);
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8)
        setMoveDialog(press.item);
      else void finishMove(press.item, target);
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    },
    onPointerCancel: () => {
      if (pressRef.current) clearTimeout(pressRef.current.timer);
      pressRef.current = null;
      setDragItem(null);
      setDropTarget(null);
      suppressClick.current = false;
    },
    onContextMenu: (event: import("react").MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (!folderBusy && !pressRef.current?.active) setMoveDialog(item);
    },
    onKeyDown: (event: import("react").KeyboardEvent<HTMLAnchorElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        if (!folderBusy) setMoveDialog(item);
      }
    },
    onDragStart: (event: import("react").DragEvent<HTMLAnchorElement>) => event.preventDefault(),
  });

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
            {dragError && (
              <p role="alert" className="text-sm text-error">
                {dragError}
              </p>
            )}
            <span id="tayori-move-help" className="sr-only">
              長押ししてドラッグで移動。キーボードでは Shift と F10 で移動先を選択できます。
            </span>
            <ul className="menu menu-sm max-h-52 w-full flex-nowrap overflow-y-auto p-0">
              {visibleFolders.map((folder) => (
                <li key={folder.id} className="tayori-folder-entry w-full">
                  <div
                    className={`tayori-folder-row flex w-full min-w-0 flex-nowrap items-center gap-1! p-1! ${dropTarget?.id === folder.id ? `tayori-drop-${dropTarget.position}` : ""}`}
                    style={{ marginInlineStart: `${Math.min(folder.depth * 16, 96)}px` }}
                    data-folder-id={folder.id}
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
                      {...moveHandlers({ kind: "folder", item: folder })}
                      draggable={false}
                      aria-describedby="tayori-move-help"
                      aria-current={folderId === folder.id ? "page" : undefined}
                      href={navigationHref(
                        { scope: "all", folderId: folder.id, sourceId: null },
                        typeof window === "undefined" ? "/" : window.location.href,
                      )}
                      className={
                        (folderId === folder.id ? "active " : "") +
                        "tayori-movable flex! min-w-0! flex-1! flex-row! flex-nowrap! items-center! justify-start! gap-2! overflow-hidden whitespace-nowrap px-2! py-1!"
                      }
                      onClick={(event) => {
                        if (suppressClick.current) {
                          event.preventDefault();
                          return;
                        }
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
                      aria-label={`「${folder.name}」のフォルダ設定`}
                      title="フォルダ設定"
                      onClick={() => onOpenFolderDialog({ mode: "edit", folder })}
                    >
                      <LuSettings aria-hidden="true" />
                    </button>
                  </div>
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
                          moveHandlers={moveHandlers}
                          suppressClick={suppressClick}
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
                      moveHandlers={moveHandlers}
                      suppressClick={suppressClick}
                    />
                  </li>
                ))}
            </ul>
            {dragItem && <div className="tayori-drop-root">ルートに移動</div>}
          </section>

          <div className="mt-auto pt-8 text-xs leading-5 text-base-content/55" aria-live="polite">
            {status ? (
              <>
                {`購読 ${status.activeSources}件 · 要確認 ${status.failingSources}件`}
                {status.lastTickAt && (
                  <>
                    <br />
                    最終更新 {formatDate(status.lastTickAt)}
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

      {moveDialog && (
        <MoveItemDialog
          moving={moveDialog}
          folders={folders}
          busy={folderBusy}
          onClose={() => setMoveDialog(null)}
          onRelocate={onRelocateItem}
          onReorder={moveFolder}
        />
      )}
      {folderDialog && (
        <FolderDialogModal
          key={
            folderDialog.mode === "edit"
              ? `edit:${folderDialog.folder.id}`
              : `create:${folderDialog.parentId ?? "root"}`
          }
          dialog={folderDialog}
          folders={folders}
          busy={folderBusy || !!movingFolder}
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
  moveHandlers,
  suppressClick,
}: {
  source: Source;
  depth?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onSettings: (source: Source) => void;
  moveHandlers: (item: MoveItem) => MoveHandlers;
  suppressClick: { current: boolean };
}) {
  return (
    <div
      className="tayori-source-row block! min-w-0 p-1!"
      style={{ marginInlineStart: `${Math.min(depth * 16, 96)}px` }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <a
          {...moveHandlers({ kind: "source", item: source })}
          draggable={false}
          aria-describedby="tayori-move-help"
          aria-current={selected ? "page" : undefined}
          href={navigationHref(
            { scope: "all", folderId: null, sourceId: source.id },
            typeof window === "undefined" ? "/" : window.location.href,
          )}
          className={`tayori-movable flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left ${selected ? "active" : ""}`}
          title={source.errorCode ? `${source.title}（取得エラー）` : source.title}
          onClick={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              return;
            }
            if (isPlainNavigation(event)) {
              event.preventDefault();
              onSelect(source.id);
            }
          }}
        >
          <SourceIcon
            key={`${source.siteUrl ?? ""}|${source.url}`}
            siteUrl={source.siteUrl}
            feedUrl={source.url}
          />
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

/** Uses the site's conventional favicon, falling back to the feed host and then the RSS icon. */
function SourceIcon({ siteUrl, feedUrl }: { siteUrl?: string | null; feedUrl: string }) {
  const urls = [siteUrl, feedUrl]
    .flatMap((value) => {
      if (!value) return [];
      try {
        const url = new URL(normalizeFeedUrl(value));
        return [`${url.origin}/favicon.ico`];
      } catch {
        return [];
      }
    })
    .filter((url, index, all) => all.indexOf(url) === index);
  const [attempt, setAttempt] = useState(0);
  return urls[attempt] ? (
    <img
      className="tayori-source-icon"
      src={urls[attempt]}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setAttempt((current) => current + 1)}
    />
  ) : (
    <LuRss className="tayori-source-icon tayori-source-icon-fallback" aria-hidden="true" />
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
