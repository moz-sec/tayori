import { useLayoutEffect, useRef, useState } from "react";
import { flattenFolders } from "../lib/folder-tree";
import { humanError } from "../lib/errors";
import type { Folder, Source } from "../types";

export type MoveItem = { kind: "folder"; item: Folder } | { kind: "source"; item: Source };

export function MoveItemDialog({
  moving,
  folders,
  busy,
  onClose,
  onRelocate,
  onReorder,
}: {
  moving: MoveItem;
  folders: Folder[];
  busy: boolean;
  onClose: () => void;
  onRelocate: (kind: "folder" | "source", id: string, parentId: string | null) => Promise<void>;
  onReorder: (id: string, direction: "up" | "down") => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(
    moving.kind === "folder" ? (moving.item.parentId ?? "") : (moving.item.folderId ?? ""),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const item = moving.item;
  const name = moving.kind === "folder" ? moving.item.name : moving.item.title;
  const siblings =
    moving.kind === "folder"
      ? folders.filter((folder) => folder.parentId === moving.item.parentId)
      : [];
  const forbidden = new Set<string>();
  if (moving.kind === "folder") {
    forbidden.add(item.id);
    let previousSize = 0;
    while (previousSize !== forbidden.size) {
      previousSize = forbidden.size;
      for (const folder of folders)
        if (folder.parentId && forbidden.has(folder.parentId)) forbidden.add(folder.id);
    }
  }
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close();
      requestAnimationFrame(() => {
        if (opener?.isConnected && !opener.closest("[inert]") && opener.getClientRects().length) {
          opener.focus();
          if (document.activeElement === opener) return;
        }
        const closeSidebar = document.getElementById("tayori-sidebar-close");
        if (closeSidebar?.getClientRects().length) {
          closeSidebar.focus();
          if (document.activeElement === closeSidebar) return;
        }
        document.querySelector<HTMLButtonElement>('button[aria-label="更新"]')?.focus();
      });
    };
  }, []);
  const run = async (action: () => Promise<void>, close: boolean) => {
    if (busy || pending) return;
    setPending(true);
    setError("");
    try {
      await action();
      if (close) onClose();
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="modal modal-open z-50"
      aria-labelledby="move-item-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !pending) onClose();
      }}
    >
      <div className="modal-box tayori-source-settings">
        <h2 id="move-item-title" className="mb-4 text-lg font-bold">
          「{name}」を移動
        </h2>
        {error && (
          <p role="alert" className="mb-3 text-error">
            {error}
          </p>
        )}
        <label className="form-control w-full">
          <span className="label-text">移動先</span>
          <select
            className="select select-bordered w-full"
            value={destination}
            disabled={busy || pending}
            onChange={(event) => setDestination(event.currentTarget.value)}
          >
            <option value="">フォルダなし（ルート）</option>
            {flattenFolders(folders)
              .filter((folder) => !forbidden.has(folder.id))
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {"　".repeat(folder.depth)}
                  {folder.name}
                </option>
              ))}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy ||
              pending ||
              destination ===
                (moving.kind === "folder"
                  ? (moving.item.parentId ?? "")
                  : (moving.item.folderId ?? ""))
            }
            onClick={() =>
              void run(() => onRelocate(moving.kind, item.id, destination || null), true)
            }
          >
            移動
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || pending}
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        {moving.kind === "folder" && (
          <section className="mt-6 border-t border-base-300 pt-4" aria-label="フォルダの並べ替え">
            <h3 className="mb-2 font-semibold">同じ階層で並べ替え</h3>
            <div className="flex flex-wrap gap-2">
              {(["up", "down"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={
                    busy ||
                    pending ||
                    (direction === "up" ? siblings[0]?.id : siblings.at(-1)?.id) === item.id
                  }
                  onClick={() => void run(() => onReorder(item.id, direction), false)}
                >
                  {direction === "up" ? "上へ移動" : "下へ移動"}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </dialog>
  );
}
