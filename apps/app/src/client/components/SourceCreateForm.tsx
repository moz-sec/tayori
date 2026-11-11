import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { formError, type FormError } from "../lib/form-error";
import type { Folder } from "../types";

interface SourceCreateFormProps {
  folders: Array<Folder & { depth: number }>;
  onPendingChange?: (pending: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
}

/** Keeps a failed subscription's input and error together, including for keyboard users. */
export function SourceCreateForm({ folders, onSubmit, onPendingChange }: SourceCreateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const stopFocusTrackingRef = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [message, setMessage] = useState("");
  const errorId = useId();
  const helpId = useId();
  const folderId = useId();
  useLayoutEffect(() => {
    if (!error || pending) return;
    const field = error.field ? formRef.current?.elements.namedItem(error.field) : null;
    if (field instanceof HTMLElement) field.focus();
    else errorRef.current?.focus();
  }, [error, pending]);

  useLayoutEffect(() => () => stopFocusTrackingRef.current?.(), []);
  useLayoutEffect(() => {
    if (pending) return;
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (
      !error &&
      target?.isConnected &&
      (document.activeElement === document.body || document.activeElement === target)
    ) {
      target.focus({ preventScroll: true });
    }
  }, [pending, error]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const active = document.activeElement;
    const focusTarget =
      active instanceof HTMLElement && event.currentTarget.contains(active) ? active : null;
    let focusMoved = false;
    const trackFocus = (event: FocusEvent) => {
      if (event.target !== document.body && event.target !== focusTarget) focusMoved = true;
    };
    document.addEventListener("focusin", trackFocus);
    stopFocusTrackingRef.current = () => document.removeEventListener("focusin", trackFocus);
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    setMessage("");
    try {
      await onSubmit(event);
      setMessage("購読先を追加しました。");
      if (!focusMoved) restoreFocusRef.current = focusTarget;
    } catch (cause) {
      setError(formError(cause, "source"));
    } finally {
      stopFocusTrackingRef.current?.();
      stopFocusTrackingRef.current = null;
      submitting.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  };
  const errorMessage = (
    <p ref={errorRef} id={errorId} role="alert" tabIndex={-1} className="text-sm text-error">
      {error?.message}
    </p>
  );

  return (
    <form
      ref={formRef}
      aria-label="購読先を追加"
      aria-busy={pending}
      className="tayori-source-form mt-5"
      onSubmit={(event) => void submit(event)}
      onInput={(event) => {
        const target = event.target;
        if (
          error?.field &&
          (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) &&
          target.name === error.field
        )
          setError(null);
      }}
    >
      {message && (
        <p role="status" className="mb-2 text-sm">
          {message}
        </p>
      )}
      {error && !error.field && errorMessage}
      <fieldset className="space-y-4" disabled={pending}>
        <label className="block text-sm font-semibold">
          RSS / Atom URL
          <input
            className="input input-bordered mt-1 w-full"
            name="url"
            type="url"
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/feed.xml"
            required
            aria-invalid={error?.field === "url" || undefined}
            aria-describedby={error?.field === "url" ? `${helpId} ${errorId}` : helpId}
          />
        </label>
        <p id={helpId} className="text-xs text-base-content/70">
          RSSまたはAtomのフィードURLを入力してください。
        </p>
        {error?.field === "url" && errorMessage}
        <label className="block text-sm font-semibold">
          表示名（任意）
          <input
            className="input input-bordered mt-1 w-full"
            name="title"
            maxLength={100}
            autoComplete="off"
            placeholder="表示名（任意）"
            aria-invalid={error?.field === "title" || undefined}
            aria-describedby={error?.field === "title" ? errorId : undefined}
          />
        </label>
        {error?.field === "title" && errorMessage}
        <div>
          <label htmlFor={folderId} className="block text-sm font-semibold">
            所属フォルダ
          </label>
          <select
            id={folderId}
            className="select select-bordered mt-1 w-full"
            name="folderId"
            defaultValue=""
          >
            <option value="">フォルダなし（ルート）</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {"　".repeat(folder.depth)}
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          {pending ? "購読先を追加中…" : "購読先を追加"}
        </button>
      </fieldset>
    </form>
  );
}
