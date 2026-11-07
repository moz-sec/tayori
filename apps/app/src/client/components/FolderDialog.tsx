import { useLayoutEffect, useRef, type FormEvent } from "react";
import { FolderDeleteControl } from "./FolderDeleteControl";
import { flattenFolders } from "../lib/folder-tree";
import type { Folder, FolderDialog as FolderDialogState } from "../types";

interface FolderDialogProps {
  dialog: FolderDialogState;
  folders: Folder[];
  busy: boolean;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (folder: Folder) => Promise<void>;
  onFallbackFocus?: () => void;
}

/** Uses the browser's modal focus handling, including when opened from the mobile sidebar. */
export function FolderDialog({ dialog, folders, busy, onClose, onSave, onDelete, onFallbackFocus }: FolderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  const fallbackRef = useRef(onFallbackFocus);
  useLayoutEffect(() => { busyRef.current = busy; fallbackRef.current = onFallbackFocus; }, [busy, onFallbackFocus]);

  useLayoutEffect(() => {
    const modal = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal?.showModal();
    // Focus the heading on smaller screens rather than opening the software keyboard immediately.
    if (window.matchMedia("(min-width: 1024px)").matches) nameRef.current?.focus();
    else headingRef.current?.focus();
    return () => {
      if (modal?.open) modal.close();
      requestAnimationFrame(() => {
        if (opener?.isConnected && !opener.closest("[inert]") && opener.getClientRects().length) {
          opener.focus();
          if (document.activeElement === opener) return;
        }
        if (fallbackRef.current) fallbackRef.current();
        else {
          const sidebarClose = document.getElementById("tayori-sidebar-close");
          if (sidebarClose?.getClientRects().length) {
            sidebarClose.focus();
            if (document.activeElement === sidebarClose) return;
          }
          document.querySelector<HTMLButtonElement>('button[aria-label="更新"]')?.focus();
        }
      });
    };
  }, []);

  const dismiss = () => { if (!busyRef.current) onClose(); };
  const flatFolders = flattenFolders(folders);

  return <dialog ref={dialogRef} className="modal modal-open z-50" aria-modal="true" aria-labelledby="folder-dialog-title" aria-busy={busy} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}>
    <div className="modal-box">
      <h2 ref={headingRef} id="folder-dialog-title" tabIndex={-1} className="mb-4 text-lg font-bold">{dialog.mode === "create" ? "New folder" : "Folder settings"}</h2>
      <form onSubmit={(event) => { if (busyRef.current) event.preventDefault(); else onSave(event); }}>
        <fieldset className="space-y-4" disabled={busy}>
          <label className="form-control w-full">
            <span className="label-text mb-1">Folder name</span>
            <input ref={nameRef} className="input input-bordered w-full" name="name" maxLength={100} defaultValue={dialog.mode === "edit" ? dialog.folder.name : ""} placeholder="Folder name" required />
          </label>
          <label className="form-control w-full">
            <span className="label-text mb-1">Parent folder</span>
            <select className="select select-bordered w-full" name="parentId" defaultValue={dialog.mode === "create" ? dialog.parentId ?? "" : dialog.folder.parentId ?? ""}>
              <option value="">Top level</option>
              {flatFolders.filter((folder) => dialog.mode === "create" || folder.id !== dialog.folder.id).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}
            </select>
          </label>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={dismiss}>Cancel</button>
            <button type="submit" className="btn btn-primary">{busy ? "処理中…" : dialog.mode === "create" ? "Create" : "Save"}</button>
          </div>
        </fieldset>
      </form>
      {dialog.mode === "edit" && <FolderDeleteControl key={dialog.folder.id} folder={dialog.folder} folders={folders} disabled={busy} onDelete={onDelete} />}
    </div>
  </dialog>;
}
