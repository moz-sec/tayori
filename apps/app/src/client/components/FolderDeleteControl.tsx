import { useRef, useState } from "react";
import type { Folder } from "../types";
import { humanError } from "../lib/errors";

/** Confirms where a deleted folder's contents will move and retains failures for retry. */
export function FolderDeleteControl({ folder, folders, disabled, onDelete }: {
  folder: Folder;
  folders: Folder[];
  disabled: boolean;
  onDelete: (folder: Folder) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const parent = folders.find((item) => item.id === folder.parentId);
  const destination = folder.parentId ? `親フォルダ「${parent?.name ?? "（名称不明）"}」` : null;

  const remove = async () => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setError("");
    try { await onDelete(folder); }
    catch (cause) { setError(humanError(cause)); }
    finally { submitting.current = false; }
  };

  return <section className="mt-6 border-t border-base-300 pt-4" aria-label="フォルダ削除">
    {confirming ? <>
      <p className="font-semibold">「{folder.name}」を削除しますか？</p>
      <p className="mt-2 text-sm">{destination
        ? `直下の子フォルダと購読先は${destination}へ移動します。`
        : "直下の子フォルダは最上位へ、購読先は未分類へ移動します。"} 配下の記事や購読先は削除しません。</p>
      <p className="mt-2 text-sm">移動先に同名のフォルダがある場合は削除できません。フォルダの削除は取り消せません。</p>
      {error && <p className="mt-2 text-sm text-error" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-error btn-sm" type="button" disabled={disabled} onClick={() => void remove()}>{disabled ? "削除中…" : "確認して削除"}</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={disabled} onClick={() => { setConfirming(false); setError(""); }}>削除を取り消す</button>
      </div>
    </> : <button className="btn btn-error btn-outline btn-sm" type="button" disabled={disabled} onClick={() => setConfirming(true)}>フォルダを削除</button>}
  </section>;
}
