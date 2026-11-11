import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LuX } from "react-icons/lu";
import { request } from "../lib/api-client";
import { humanError } from "../lib/errors";
import { formatDate } from "../lib/format";
import { feedErrorMessage } from "../lib/feed-status";
import type { Folder, Source } from "../types";

interface SourceSettingsDialogProps {
  source: Source;
  folders: Folder[];
  onClose: () => void;
  onFallbackFocus?: () => void;
  onCommitted: (sourceId: string, archived: boolean) => Promise<void>;
  onConflict: () => Promise<void>;
}

/** Edits a subscription while retaining entered values and errors until the API accepts them. */
export function SourceSettingsDialog({
  source,
  folders,
  onClose,
  onCommitted,
  onFallbackFocus,
  onConflict,
}: SourceSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  /** Leaves the browser's modal state before restoring a usable focus target. */
  const dismiss = (forceFallback = false) => {
    dialogRef.current?.close();
    onClose();
    // A successful move/archive may remove the opener in the pending React commit.
    requestAnimationFrame(() => {
      if (!forceFallback && openerRef.current?.isConnected) openerRef.current.focus();
      else onFallbackFocus?.();
    });
  };
  const [title, setTitle] = useState(source.title);
  const [url, setUrl] = useState(source.url);
  const [folderId, setFolderId] = useState(source.folderId ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveAccepted, setArchiveAccepted] = useState(false);
  const [error, setError] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));

  /** Commits one mutation and only closes the dialog after the server confirms it. */
  const commit = async (archived: boolean) => {
    if (pendingRef.current || conflicted || (archived && !archiveAccepted)) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await request(
        `/sources/${encodeURIComponent(source.id)}`,
        archived
          ? { method: "DELETE" }
          : {
              method: "PATCH",
              body: JSON.stringify({
                expectedGeneration: source.generation,
                ...(title.trim() !== source.title ? { title: title.trim() } : {}),
                ...(url.trim() !== source.url ? { url: url.trim() } : {}),
                folderId: folderId || null,
              }),
            },
      );
      await onCommitted(source.id, archived);
      dismiss(archived || (folderId || null) !== source.folderId);
    } catch (cause) {
      setError(humanError(cause));
      if (cause instanceof Error && cause.message === "SOURCE_VERSION_CONFLICT") {
        // A stale draft must not be retried against a subscription the user has not seen.
        setConflicted(true);
        try {
          await onConflict();
        } catch {
          setError(
            `${humanError(cause)} 最新の設定を取得できませんでした。記事一覧の更新後に開き直してください。`,
          );
        }
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  /** Submits only the editable draft; archive confirmation uses its separate action. */
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmArchive) void commit(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      className="modal modal-open z-50"
      aria-labelledby="source-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pendingRef.current) dismiss();
      }}
    >
      <div className="modal-box tayori-source-settings">
        <div className="tayori-source-settings-header">
          <h2 id="source-settings-title" className="text-lg font-bold">
            {source.title}
          </h2>
          <button
            className="btn btn-ghost btn-square btn-sm"
            type="button"
            disabled={pending}
            aria-label="閉じる"
            title="閉じる"
            onClick={() => {
              if (!pendingRef.current) dismiss();
            }}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        {error && (
          <p role="alert" className="alert alert-error mb-4">
            {error}
          </p>
        )}
        <form onSubmit={save}>
          <fieldset className="space-y-4" disabled={pending || confirmArchive || conflicted}>
            <label className="form-control w-full">
              <span className="label-text mb-1">RSS / Atom URL</span>
              <input
                className="input input-bordered w-full"
                name="url"
                type="url"
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.currentTarget.value)}
                aria-describedby="source-url-help"
                required
              />
            </label>
            <p id="source-url-help" className="text-sm text-base-content/70">
              配信元の記事IDや記事URLが変わると、同じ内容でも新しい記事として登録される場合があります。
            </p>
            <label className="form-control w-full">
              <span className="label-text mb-1">表示名</span>
              <input
                className="input input-bordered w-full"
                name="title"
                maxLength={100}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                required
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text mb-1">所属フォルダ</span>
              <select
                className="select select-bordered w-full"
                name="folderId"
                value={folderId}
                onChange={(event) => setFolderId(event.currentTarget.value)}
              >
                <option value="">フォルダなし（ルート）</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folderPath(folder, folderById)}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" type="submit">
              {pending ? "処理中…" : "保存"}
            </button>
          </fieldset>
        </form>
        <section className="mt-6 border-t border-base-300 pt-4 text-sm" aria-label="取得状況">
          <details>
            <summary
              className={`cursor-pointer font-semibold ${source.errorCode ? "text-error" : ""}`}
            >
              取得状況{source.errorCode && "（取得エラー）"}
            </summary>
            <div className="mt-3">
              <p>
                {source.errorCode
                  ? "取得エラー"
                  : source.lastCheckedAt
                    ? "定期収集が有効"
                    : "初回取得の確認待ち"}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 break-words sm:grid-cols-[10rem_1fr]">
                <dt>最終確認（成功・失敗を含む）</dt>
                <dd>
                  {source.lastCheckedAt ? formatDate(source.lastCheckedAt) : "まだ確認していません"}
                </dd>
                <dt>最終成功（更新なしを含む）</dt>
                <dd>
                  {source.lastSuccessAt ? formatDate(source.lastSuccessAt) : "まだ成功していません"}
                </dd>
                <dt>次回対象時刻</dt>
                <dd>{formatDate(source.nextFetchAt)}</dd>
                <dt>連続失敗</dt>
                <dd>{source.consecutiveFailures}回</dd>
                {source.errorCode && (
                  <>
                    <dt>取得エラー</dt>
                    <dd className="text-error">
                      {feedErrorMessage(source.errorCode)}
                      <br />
                      <span className="break-all">コード: {source.errorCode}</span>
                    </dd>
                  </>
                )}
              </dl>
              {source.status === "active" && (
                <p className="mt-3 text-base-content/70">
                  次回対象時刻は取得完了時刻ではありません。毎時の収集処理・待機状況により遅れることがあります。
                </p>
              )}
            </div>
          </details>
        </section>
        <section className="mt-6 border-t border-base-300 pt-4" aria-label="購読解除">
          {confirmArchive ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                購読先一覧から外れ、今後の収集は停止します。既存の記事と既読・保存状態は残ります。
                通常の記事は保存期限で削除されますが、お気に入り・あとで読むの記事は保持されます。
                残った記事は「すべての記事」などから閲覧できます。
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  className="checkbox checkbox-sm"
                  type="checkbox"
                  checked={archiveAccepted}
                  disabled={pending}
                  onChange={(event) => setArchiveAccepted(event.currentTarget.checked)}
                />
                <span>「{source.title}」の購読を解除します</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-error btn-sm"
                  type="button"
                  disabled={pending || conflicted || !archiveAccepted}
                  onClick={() => void commit(true)}
                >
                  確認して購読解除
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={pending || conflicted}
                  onClick={() => {
                    setConfirmArchive(false);
                    setArchiveAccepted(false);
                    setError("");
                  }}
                >
                  解除を取り消す
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-outline btn-error btn-sm mt-3"
              type="button"
              disabled={pending || conflicted}
              onClick={() => {
                setConfirmArchive(true);
                setError("");
              }}
            >
              購読解除…
            </button>
          )}
        </section>
      </div>
    </dialog>
  );
}

/** Disambiguates folders with identical names by showing their ancestor path. */
function folderPath(folder: Folder, byId: Map<string, Folder>): string {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}
