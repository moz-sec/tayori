import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LuX } from "react-icons/lu";
import { FolderDeleteControl } from "./FolderDeleteControl";
import { formError, type FormError } from "../lib/form-error";
import type { Folder, FolderDialog as FolderDialogState } from "../types";

interface FolderDialogProps {
  dialog: FolderDialogState;
  folders: Folder[];
  busy: boolean;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onDelete: (folder: Folder) => Promise<void>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  onFallbackFocus?: () => void;
}

/** Uses the browser's modal focus handling, including when opened from the mobile sidebar. */
export function FolderDialog({
  dialog,
  folders,
  busy,
  onClose,
  onSave,
  onDelete,
  onMove,
  onFallbackFocus,
}: FolderDialogProps) {
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
  useLayoutEffect(() => {
    busyRef.current = busy;
    fallbackRef.current = onFallbackFocus;
  }, [busy, onFallbackFocus]);

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
    if (
      field instanceof HTMLElement &&
      !(field instanceof HTMLInputElement && field.type === "hidden")
    )
      field.focus();
    else errorRef.current?.focus();
  }, [error, busy, pending]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(event);
    } catch (cause) {
      setError(formError(cause, "folder"));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const dismiss = () => {
    if (!busyRef.current && !submitting.current) onClose();
  };
  const errorMessage = (
    <p
      ref={errorRef}
      id="folder-form-error"
      role="alert"
      tabIndex={-1}
      className="text-sm text-error"
    >
      {error?.message}
    </p>
  );

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-open z-50"
      aria-modal="true"
      aria-labelledby="folder-dialog-title"
      aria-busy={busy || pending}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
    >
      <div className={dialog.mode === "edit" ? "modal-box tayori-source-settings" : "modal-box"}>
        <div className={dialog.mode === "edit" ? "tayori-source-settings-header" : undefined}>
          <h2
            ref={headingRef}
            id="folder-dialog-title"
            tabIndex={-1}
            className="mb-4 text-lg font-bold"
          >
            {dialog.mode === "create" ? "フォルダを作成" : "フォルダ設定"}
          </h2>
          {dialog.mode === "edit" && (
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm"
              disabled={busy || pending}
              aria-label="閉じる"
              title="閉じる"
              onClick={dismiss}
            >
              <LuX aria-hidden="true" />
            </button>
          )}
        </div>
        <form ref={formRef} onSubmit={(event) => void submit(event)} onInput={() => setError(null)}>
          {error && error.field !== "name" && errorMessage}
          <fieldset className="space-y-4" disabled={busy || pending}>
            <label className="form-control w-full">
              <span className="label-text mb-1">フォルダ名</span>
              <input
                ref={nameRef}
                className="input input-bordered w-full"
                name="name"
                maxLength={100}
                defaultValue={dialog.mode === "edit" ? dialog.folder.name : ""}
                placeholder="フォルダ名"
                autoComplete="off"
                required
                aria-invalid={error?.field === "name" || undefined}
                aria-describedby={error?.field === "name" ? "folder-form-error" : undefined}
              />
            </label>
            {error?.field === "name" && errorMessage}
            <input
              type="hidden"
              name="parentId"
              value={dialog.mode === "edit" ? (dialog.folder.parentId ?? "") : ""}
            />
            <div className="modal-action">
              {dialog.mode === "create" && (
                <button type="button" className="btn btn-ghost" onClick={dismiss}>
                  キャンセル
                </button>
              )}
              <button type="submit" className="btn btn-primary">
                {busy || pending
                  ? "処理中…"
                  : dialog.mode === "create"
                    ? "フォルダを作成"
                    : "変更を保存"}
              </button>
            </div>
          </fieldset>
        </form>
        {dialog.mode === "edit" && (
          <div className="mt-6 flex gap-2" aria-label="フォルダの並べ替え" role="group">
            {(["up", "down"] as const).map((direction) => {
              const siblings = folders.filter(
                (folder) => folder.parentId === dialog.folder.parentId,
              );
              const boundary = direction === "up" ? siblings[0] : siblings.at(-1);
              const label = direction === "up" ? "上へ移動" : "下へ移動";
              return (
                <button
                  key={direction}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`${dialog.folder.name}を${label}`}
                  disabled={busy || pending || boundary?.id === dialog.folder.id}
                  onClick={() => void onMove(dialog.folder.id, direction)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {dialog.mode === "edit" && (
          <FolderDeleteControl
            key={dialog.folder.id}
            folder={dialog.folder}
            folders={folders}
            disabled={busy || pending}
            onDelete={onDelete}
          />
        )}
      </div>
    </dialog>
  );
}
