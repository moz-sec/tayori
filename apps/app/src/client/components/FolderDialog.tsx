import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { FolderDeleteControl } from "./FolderDeleteControl";
import { formError, type FormError } from "../lib/form-error";
import { flattenFolders } from "../lib/folder-tree";
import type { Folder, FolderDialog as FolderDialogState } from "../types";

interface FolderDialogProps {
  dialog: FolderDialogState;
  folders: Folder[];
  busy: boolean;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onDelete: (folder: Folder) => Promise<void>;
  onFallbackFocus?: () => void;
}

/** Uses the browser's modal focus handling, including when opened from the mobile sidebar. */
export function FolderDialog({ dialog, folders, busy, onClose, onSave, onDelete, onFallbackFocus }: FolderDialogProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState<FormError | null>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
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

  useLayoutEffect(() => {
    if (!error || busy || pending) return;
    const field = error.field ? formRef.current?.elements.namedItem(error.field) : null;
    if (field instanceof HTMLElement) field.focus();
    else errorRef.current?.focus();
  }, [error, busy, pending]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try { await onSave(event); }
    catch (cause) { setError(formError(cause, "folder")); }
    finally { submitting.current = false; setPending(false); }
  };
  const dismiss = () => { if (!busyRef.current && !submitting.current) onClose(); };
  const errorMessage = <p ref={errorRef} id="folder-form-error" role="alert" tabIndex={-1} className="text-sm text-error">{error?.message}</p>;
  const flatFolders = flattenFolders(folders);

  return <dialog ref={dialogRef} className="modal modal-open z-50" aria-modal="true" aria-labelledby="folder-dialog-title" aria-busy={busy || pending} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}>
    <div className="modal-box">
      <h2 ref={headingRef} id="folder-dialog-title" tabIndex={-1} className="mb-4 text-lg font-bold">{dialog.mode === "create" ? "New folder" : "Folder settings"}</h2>
      <form ref={formRef} onSubmit={(event) => void submit(event)} onInput={() => setError(null)}>
        {error && !error.field && errorMessage}
        <fieldset className="space-y-4" disabled={busy || pending}>
          <label className="form-control w-full">
            <span className="label-text mb-1">Folder name</span>
            <input ref={nameRef} className="input input-bordered w-full" name="name" maxLength={100} defaultValue={dialog.mode === "edit" ? dialog.folder.name : ""} placeholder="Folder name" autoComplete="off" required aria-invalid={error?.field === "name" || undefined} aria-describedby={error?.field === "name" ? "folder-form-error" : undefined} />
          </label>
          {error?.field === "name" && errorMessage}
          <label className="form-control w-full">
            <span className="label-text mb-1">Parent folder</span>
            <select aria-invalid={error?.field === "parentId" || undefined} aria-describedby={error?.field === "parentId" ? "folder-form-error" : undefined} className="select select-bordered w-full" name="parentId" defaultValue={dialog.mode === "create" ? dialog.parentId ?? "" : dialog.folder.parentId ?? ""}>
              <option value="">Top level</option>
              {flatFolders.filter((folder) => dialog.mode === "create" || folder.id !== dialog.folder.id).map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}
            </select>
          </label>
          {error?.field === "parentId" && errorMessage}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={dismiss}>Cancel</button>
            <button type="submit" className="btn btn-primary">{busy || pending ? "処理中…" : dialog.mode === "create" ? "Create" : "Save"}</button>
          </div>
        </fieldset>
      </form>
      {dialog.mode === "edit" && <FolderDeleteControl key={dialog.folder.id} folder={dialog.folder} folders={folders} disabled={busy || pending} onDelete={onDelete} />}
    </div>
  </dialog>;
}
