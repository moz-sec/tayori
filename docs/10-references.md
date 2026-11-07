# 公式資料と確認記録

確認日: 2026-09-29。Cloudflareの現行公式ドキュメントを優先し、ローカルスキルの古い料金例・API例は仕様根拠として採用しない。

- 参照: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
  - 確認項目: Free HTTP/Cron CPU、リクエスト、subrequest、memory

- 参照: [Queues Limits](https://developers.cloudflare.com/queues/platform/limits/)
  - 確認項目: consumer CPU/wall time、Freeの保持期間

- 参照: [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
  - 確認項目: Free操作数、write/read/delete、再試行・バッチの数え方

- 参照: [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
  - 確認項目: at-least-once、重複配信

- 参照: [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
  - 確認項目: 1DB容量、bind数、クエリ数

- 参照: [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
  - 確認項目: 読取/書込行、インデックス、上限時の動作

- 参照: [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
  - 確認項目: batchのトランザクション動作

- 参照: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  - 確認項目: Free復旧期間と利用条件

- 参照: [D1 Import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
  - 確認項目: SQLエクスポートと復元

- 参照: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
  - 確認項目: scheduled handlerと定期起動

- 参照: [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
  - 確認項目: 静的配信とWorker呼出しの区別

- 参照: [Access on Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
  - 確認項目: Worker保護とidentity

- 参照: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
  - 確認項目: 本番/previewの保護・経路

- 参照:
  [Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
  - 確認項目: 本人メールによるログイン

## 検証に残すこと

- 実アカウントがFreeか、共有無料枠の残余。
- Queues Freeでのconsumer CPUとWrangler設定の受理。HTTP/Cronの10msをconsumerへ無条件に当てはめない一方、5分への上限変更も未検証で約束しない。
- フィード取得成功率、D1書込行数、HTTP JWT検証のCPU負荷。
- Access保護がすべての到達URLに効くこと。
- DB実サイズ、復元時のサービス停止時間。

資料は設計の根拠であり、デプロイ済み・動作検証済みという証拠ではない。
