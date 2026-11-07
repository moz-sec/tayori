import type { D1UsageControlStatus } from "../../../../../packages/shared/src/d1-usage";

const names = { storageBytes: "保存容量", rowsRead: "読み取り行数", rowsWritten: "書き込み行数" };

export function D1UsageNotice({ status }: { status: D1UsageControlStatus }) {
  if (status.state === "ok") return null;
  if (status.state === "disabled")
    return <p>データベース利用量の監視は無効です。設定すると取り込みを保護できます。</p>;
  const label = status.metrics.map((metric) => names[metric]).join("、");
  if (status.state === "warning")
    return <p role="status">データベースの{label}が設定した上限に近づいています。</p>;
  return (
    <p role="alert">
      {status.reason === "unavailable"
        ? "データベースの利用量を確認できないため、新しい取り込みを停止しています。監視設定と接続を確認し、利用量を取得できると再開します。"
        : `データベースの${label}が設定した上限に達したため、新しい取り込みを停止しています。利用量が上限を下回ると再開します。`}
    </p>
  );
}
