import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { formError, type FormError } from "../lib/form-error";
import type { Folder } from "../types";

interface SourceCreateFormProps {
  folders: Array<Folder & { depth: number }>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
}

/** Keeps a failed subscription's input and error together, including for keyboard users. */
export function SourceCreateForm({ folders, onSubmit }: SourceCreateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const errorId = useId();
  const helpId = useId();
  const folderId = useId();
  useLayoutEffect(() => {
    if (!error || pending) return;
    const field = error.field ? formRef.current?.elements.namedItem(error.field) : null;
    if (field instanceof HTMLElement) field.focus();
    else errorRef.current?.focus();
  }, [error, pending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try { await onSubmit(event); }
    catch (cause) { setError(formError(cause, "source")); }
    finally { submitting.current = false; setPending(false); }
  };
  const errorMessage = <p ref={errorRef} id={errorId} role="alert" tabIndex={-1} className="text-sm text-error">{error?.message}</p>;

  return <form ref={formRef} aria-label="購読先を追加" aria-busy={pending} className="mt-3 rounded-box bg-base-200 p-3" onSubmit={(event) => void submit(event)} onInput={() => setError(null)}>
    <p className="mb-2 text-xs font-semibold">購読先を追加</p>
    {error && !error.field && errorMessage}
    <fieldset className="space-y-2" disabled={pending}>
      <label className="block text-xs font-semibold">
        RSS / Atom URL
        <input className="input input-bordered input-sm mt-1 w-full" name="url" type="url" maxLength={2048} autoComplete="off" spellCheck={false} placeholder="https://example.com/feed.xml" required aria-invalid={error?.field === "url" || undefined} aria-describedby={error?.field === "url" ? `${helpId} ${errorId}` : helpId} />
      </label>
      <p id={helpId} className="text-xs text-base-content/70">RSSまたはAtomのフィードURLを入力してください。</p>
      {error?.field === "url" && errorMessage}
      <label className="block text-xs font-semibold">
        表示名（任意）
        <input className="input input-bordered input-sm mt-1 w-full" name="title" maxLength={100} autoComplete="off" placeholder="表示名（任意）" aria-invalid={error?.field === "title" || undefined} aria-describedby={error?.field === "title" ? errorId : undefined} />
      </label>
      {error?.field === "title" && errorMessage}
      <div>
        <label htmlFor={folderId} className="block text-xs font-semibold">所属フォルダ</label>
        <select id={folderId} className="select select-bordered select-sm mt-1 w-full" name="folderId" defaultValue=""><option value="">未分類</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{"　".repeat(folder.depth)}{folder.name}</option>)}</select>
      </div>
      <button className="btn btn-primary btn-sm w-full" type="submit">{pending ? "購読先を追加中…" : "購読先を追加"}</button>
    </fieldset>
  </form>;
}
