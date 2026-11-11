import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LuClock3, LuRss, LuX } from "react-icons/lu";
import { CollectionSettings } from "./CollectionSettingsDialog";
import { SourceCreateForm } from "./SourceCreateForm";
import { flattenFolders } from "../lib/folder-tree";
import { humanError } from "../lib/errors";
import type { ImportRow } from "../lib/opml-import";
import type { Folder, ImportOutline, Source } from "../types";

interface SettingsDialogProps {
  initialSection?: "source" | "opml" | null;
  folders: Folder[];
  sources: Source[];
  importItems: ImportOutline[] | null;
  importSummary: string;
  importRows: ImportRow[];
  busy: boolean;
  onClose: () => void;
  onRestoreSource: (id: string) => Promise<void>;
  onCreateSource: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onImportFile: (file: File | undefined) => Promise<void> | void;
  onImportOpml: () => void;
}

/** Keeps RSS settings together while preserving native modal focus handling. */
export function SettingsDialog({
  initialSection,
  folders,
  sources,
  importItems,
  importSummary,
  importRows,
  busy,
  onClose,
  onRestoreSource,
  onCreateSource,
  onImportFile,
  onImportOpml,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const parsingImportRef = useRef(false);
  const [parsingImport, setParsingImport] = useState(false);
  const [importError, setImportError] = useState("");
  const [schedulePending, setSchedulePending] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const [restorePending, setRestorePending] = useState<string | null>(null);
  const restorePendingRef = useRef(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const blocked = busy || parsingImport || schedulePending || sourcePending || !!restorePending;
  const archivedSources = sources.filter((source) => source.status === "archived");
  const restoreSource = async (source: Source) => {
    if (restorePendingRef.current) return;
    restorePendingRef.current = true;
    setRestorePending(source.id);
    setRestoreError("");
    setRestoreMessage("");
    try {
      await onRestoreSource(source.id);
      setRestoreMessage(`${source.title}を復元しました。`);
      requestAnimationFrame(() => document.getElementById("archived-sources-title")?.focus());
    } catch (cause) {
      setRestoreError(humanError(cause));
    } finally {
      restorePendingRef.current = false;
      setRestorePending(null);
    }
  };
  useLayoutEffect(() => {
    if (document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    if (initialSection === "source") {
      dialog?.querySelector<HTMLInputElement>('input[name="url"]')?.focus();
    }
    if (initialSection === "opml") importButtonRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  useLayoutEffect(() => {
    if (importError && !parsingImport) importButtonRef.current?.focus();
  }, [importError, parsingImport]);
  const dismiss = () => {
    if (blocked || parsingImportRef.current) return;
    dialogRef.current?.close();
    onClose();
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    });
  };
  const selectImportFile = async (file: File | undefined) => {
    if (!file || busy || parsingImportRef.current) return;
    parsingImportRef.current = true;
    setParsingImport(true);
    setImportError("");
    try {
      await onImportFile(file);
    } catch (cause) {
      setImportError(humanError(cause));
    } finally {
      parsingImportRef.current = false;
      setParsingImport(false);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="modal modal-open z-50"
      aria-modal="true"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div
        className={`tayori-settings modal-box ${initialSection ? "tayori-settings--standalone" : ""}`}
      >
        {!initialSection && (
          <div className="tayori-settings-nav">
            <h2 id="settings-title" className="text-lg font-bold">
              設定
            </h2>
            <p className="tayori-settings-category">
              <LuRss aria-hidden="true" /> RSS
            </p>
            <nav className="tayori-settings-links" aria-label="設定項目">
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("collection-settings-title")
                    ?.scrollIntoView({ block: "start" })
                }
              >
                <LuClock3 aria-hidden="true" />
                収集設定
              </button>
            </nav>
          </div>
        )}
        <div className="tayori-settings-content">
          <button
            type="button"
            className="tayori-settings-close btn btn-ghost btn-square btn-sm"
            disabled={blocked}
            onClick={dismiss}
            aria-label="閉じる"
            title="閉じる"
          >
            <LuX aria-hidden="true" />
          </button>
          {initialSection && (
            <h2 id="settings-title" className="text-lg font-bold">
              {initialSection === "source" ? "購読先を追加" : "OPML"}
            </h2>
          )}
          {!initialSection && (
            <>
              <header className="tayori-settings-header">
                <h1>RSS設定</h1>
                <p>記事の収集を管理します。</p>
              </header>
              <CollectionSettings onPendingChange={setSchedulePending} />
              <section
                className="mt-6 border-t border-base-300 pt-4"
                aria-labelledby="archived-sources-title"
              >
                <h2 id="archived-sources-title" tabIndex={-1} className="text-lg font-bold">
                  購読解除した購読先
                </h2>
                <p className="tayori-settings-description">
                  購読先を復元すると、記事の収集を再開します。
                </p>
                {restoreError && (
                  <p role="alert" className="mt-3 text-error">
                    {restoreError}
                  </p>
                )}
                {restoreMessage && (
                  <p role="status" className="mt-3">
                    {restoreMessage}
                  </p>
                )}
                {archivedSources.length === 0 ? (
                  <p className="mt-3 text-base-content/70">購読解除した購読先はありません。</p>
                ) : (
                  <ul className="mt-3 divide-y divide-base-300">
                    {archivedSources.map((source) => (
                      <li key={source.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{source.title}</p>
                          <p className="break-all text-base-content/70">{source.url}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={blocked}
                          onClick={() => void restoreSource(source)}
                          aria-label={`${source.title}を復元`}
                        >
                          {restorePending === source.id ? "復元中…" : "復元"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {initialSection === "source" && (
            <section aria-label="購読先を追加">
              <p className="tayori-settings-description">フィードのURLを指定して購読します。</p>
              <SourceCreateForm
                folders={flattenFolders(folders)}
                onSubmit={onCreateSource}
                onPendingChange={setSourcePending}
              />
            </section>
          )}
          {initialSection === "opml" && (
            <section aria-label="OPML">
              <p className="mt-2 text-sm text-base-content/70">
                購読先をファイルから取り込むか、ファイルに書き出します。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  ref={importButtonRef}
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy || parsingImport}
                  aria-describedby={importError ? "opml-file-error" : undefined}
                  onClick={() => importInputRef.current?.click()}
                >
                  インポート
                </button>
                <a className="btn btn-outline btn-sm" href="/api/v1/subscriptions.opml">
                  エクスポート
                </a>
              </div>
              <div className="mt-4 space-y-2">
                <input
                  ref={importInputRef}
                  id="opml-file"
                  name="opml"
                  hidden
                  type="file"
                  disabled={busy || parsingImport}
                  accept=".opml,.xml,text/xml,application/xml"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void selectImportFile(file);
                  }}
                />
                {importError && (
                  <p id="opml-file-error" role="alert" className="text-sm text-error">
                    {importError}
                  </p>
                )}
                {importSummary && (
                  <p role="status" className="text-xs text-base-content/70">
                    {importSummary}
                  </p>
                )}
                {importRows.some((row) => row.status === "error" || row.status === "pending") && (
                  <ul
                    className="max-h-56 space-y-2 overflow-y-auto text-xs"
                    aria-label="OPML取り込みの未完了項目"
                  >
                    {importRows.map((row, index) =>
                      row.status === "error" || row.status === "pending" ? (
                        <li key={index} className="break-all">
                          <span className="font-semibold">
                            {row.status === "error" ? "失敗" : "未処理"}
                          </span>{" "}
                          {row.outline.url}
                          {row.error && <p>{row.error}</p>}
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
                {!!importItems?.length && (
                  <>
                    <p className="text-xs">対象 {importItems.length}件</p>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={onImportOpml}
                    >
                      {busy ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : importRows.some((row) => row.status !== "pending") ? (
                        "失敗・未処理分を再試行"
                      ) : (
                        "確認して取り込む"
                      )}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
