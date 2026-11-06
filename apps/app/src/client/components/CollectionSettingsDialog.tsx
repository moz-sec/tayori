import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_COLLECTION_SCHEDULE, type CollectionSchedule } from "@tayori/shared/collection-schedule";
import { request } from "../lib/api-client";
import { humanError } from "../lib/errors";

type SavedSchedule = CollectionSchedule & { next_fetch_at: string | null };

/** Keeps draft controls separate from confirmed settings and preserves input on a failed save. */
export function CollectionSettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const [draft, setDraft] = useState<CollectionSchedule>(DEFAULT_COLLECTION_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  useLayoutEffect(() => {
    if (document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void request<{ data: SavedSchedule }>("/settings/collection-schedule", { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setSaved(data);
        setDraft({ mode: data.mode, interval_hours: data.interval_hours, daily_hour_jst: data.daily_hour_jst, timezone: data.timezone });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(humanError(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadVersion]);
  const dismiss = () => {
    if (pendingRef.current) return;
    dialogRef.current?.close();
    onClose();
    requestAnimationFrame(() => { if (openerRef.current?.isConnected) openerRef.current.focus(); });
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || loading || !saved) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const { data } = await request<{ data: SavedSchedule }>("/settings/collection-schedule", { method: "PUT", body: JSON.stringify(draft) });
      setSaved(data);
      setMessage("収集設定を保存しました。次回の定期収集から適用します。");
    } catch (cause) { setError(humanError(cause)); }
    finally { pendingRef.current = false; setPending(false); }
  };
  return <dialog ref={dialogRef} className="modal modal-open z-50" aria-modal="true" aria-labelledby="collection-settings-title" onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <div className="modal-box">
      <h2 id="collection-settings-title" className="mb-4 text-lg font-bold">RSS収集設定</h2>
      <p className="mb-4 text-sm">すべての購読先に共通の設定です。日本時間（Asia/Tokyo）で定期収集します。</p>
      {loading && <p role="status">設定を読み込んでいます…</p>}
      {error && <p role="alert" className="alert alert-error mb-4">{error}</p>}
      {!loading && !saved && <button className="btn btn-outline" onClick={() => setLoadVersion((value) => value + 1)}>設定を再読み込み</button>}
      {saved && <section className="mb-4 rounded-box bg-base-200 p-4 text-sm" aria-label="保存済みの収集設定">
        <p>保存済み：{saved.mode === "interval" ? `${saved.interval_hours}時間ごと` : `毎日 ${saved.daily_hour_jst}:00（日本時間）`}</p>
        <p className="mt-2">次回取得予定：{saved.next_fetch_at ? new Date(saved.next_fetch_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) + "（日本時間）" : "収集対象の購読先がありません"}</p>
      </section>}
      <form onSubmit={(event) => void save(event)}>
        <fieldset className="space-y-4" disabled={loading || pending || !saved}>
          <label className="form-control w-full">
            <span className="label-text mb-1">収集方法</span>
            <select className="select select-bordered w-full" value={draft.mode} onChange={(event) => { setDraft({ ...draft, mode: event.currentTarget.value as CollectionSchedule["mode"] }); setMessage(""); }}>
              <option value="interval">取得間隔</option><option value="daily">毎日の実行時刻</option>
            </select>
          </label>
          {draft.mode === "interval" ? <label className="form-control w-full">
            <span className="label-text mb-1">取得間隔</span>
            <select className="select select-bordered w-full" value={draft.interval_hours} onChange={(event) => { setDraft({ ...draft, interval_hours: Number(event.currentTarget.value) as CollectionSchedule["interval_hours"] }); setMessage(""); }}>
              {[1, 2, 3, 6, 12, 24].map((hours) => <option key={hours} value={hours}>{hours}時間ごと</option>)}
            </select>
          </label> : <label className="form-control w-full">
            <span className="label-text mb-1">毎日の実行時刻（日本時間）</span>
            <select className="select select-bordered w-full" value={draft.daily_hour_jst} onChange={(event) => { setDraft({ ...draft, daily_hour_jst: Number(event.currentTarget.value) }); setMessage(""); }}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour}:00</option>)}
            </select>
          </label>}
          <p className="text-sm">保存や記事一覧の更新では、RSSをすぐに取得しません。Queueの待ち時間や失敗後の再試行により、取得完了は予定より遅れることがあります。記事の保存期間は7日間です。</p>
          <button type="submit" className="btn btn-primary">{pending ? "保存中…" : "収集設定を保存"}</button>
        </fieldset>
      </form>
      {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      <div className="modal-action"><button type="button" className="btn btn-ghost" disabled={pending} onClick={dismiss}>閉じる</button></div>
    </div>
  </dialog>;
}
