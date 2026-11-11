# 無料枠・運用設計

確認日: 2026-09-29。数値は公式資料によるプラン上限と、本アプリの設計上の予算を区別する。

## 1. Cloudflareの主な上限

- 対象: Workers
  - Freeの値: HTTP/Cron CPU 10ms、10万request/日、128MB
  - 参照: [制限](https://developers.cloudflare.com/workers/platform/limits/)

- 対象: Cron
  - Freeの値: アカウント5設定
  - 参照: 同上

- 対象: Queues
  - Freeの値: 1万操作/日、保持24時間
  - 参照: [料金](https://developers.cloudflare.com/queues/platform/pricing/)

- 対象: Queue consumer
  - Freeの値: 標準CPU30秒、wall time15分という記載。Free実証を先行
  - 参照: [制限](https://developers.cloudflare.com/queues/platform/limits/)

- 対象: D1
  - Freeの値: 読取500万行/日、書込10万行/日
  - 参照: [料金](https://developers.cloudflare.com/d1/platform/pricing/)

- 対象: D1容量
  - Freeの値: 1DB 500MB、アカウント合計5GB
  - 参照: [制限](https://developers.cloudflare.com/d1/platform/limits/)

- 対象: D1実行
  - Freeの値: Freeは50クエリ/Worker実行、bind100個/文
  - 参照: 同上

- 対象: D1 Time Travel
  - Freeの値: Freeは7日
  - 参照: [バックアップ](https://developers.cloudflare.com/d1/reference/time-travel/)

既存の Worker、D1、Queue、ステージング環境の使用量も合算する。D1 の上限に達するとクエリは失敗する。Paid へ変更すると月額料金や従量課金が発生するため、アプリ内の予算設定だけで0円を保証することはできない。

## 2. Queue操作の試算

1メッセージ64KB未満、通常成功をwrite/read/deleteの3操作と仮定する。50購読先すべてを毎時取得し、未完了ジョブがない場合、fetchは1日1,200件、tickは毎時の1件と10件ずつの選定に伴う継続5件で1日144件となり、
基本操作は1日4,032回となる。再試行、重複送信、初回登録時の取得、障害回復は含まない。取得間隔は1時間以上で設定する。

アプリ側では、UTC日ごとに8,000操作を上限として予約する。最初のtick処理と継続tickの送信、およびfetchの送信ごとに4操作を予約する。最初のtick自体は予約前に送信されるため、予約上限はQueueの実操作数を厳密には制限しない。
予算不足時は処理を停止し、次のUTC日以降のtickで残りを処理する。送信に失敗しても予約分は払い戻さない。

これは概算に基づく制御であり、重複配信、日をまたぐ処理、他のアプリの使用量まで含めて課金を厳密に制御するものではない。Cloudflare の実測値も確認し、共有枠に合わせて8,000回の上限をさらに下げる。

## 3. D1と容量の試算

仮定: 50購読先×10新着/日=500記事/日、保存レコード平均4KiB（索引等を含む仮置き）。通常記事7日分は約13.7MiB。お気に入り等は別途累積する。

記事識別情報を保存する `item_keys` が1件あたり200Bと仮定すると、年間で約36.5MB増える。実際の容量は SQLite のページや索引によって変わるため、DB のサイズを定期的に確認する。記事を7日間保持しても、DB
全体の容量は一定にならない。

fetch 関連で1回あたり20行、新着記事と索引・記事識別情報で1件あたり10行、期限切れ記事の削除で1件あたり10行を書き込むと仮定する。この場合、1,200×20+500×10+500×10で1日あたり34,000行になる。tick、
API、ジョブ整理による書き込みは別途加算する。実測した `meta.rows_written` に合わせて係数を見直す。HTTP 304 の場合も取得状態を更新するため、書き込みが発生する。

ETag非対応サイトで全記事を毎回UPDATEすると、この見積もりを大きく超える。content_hashが同じ記事は書き込まない。

## 4. 停止と保持

TayoriはWorkers Freeで運用する。D1の利用量の可視化と上限通知はCloudflareに任せ、CollectorからAnalytics APIやREST APIを定期取得しない。
利用量のキャッシュ、独自のD1警告・停止閾値、観測値が欠けた場合の取り込み停止、アプリ画面での利用量表示は持たない。

### D1の標準上限と通知

Freeの日次枠はアカウント合計で読み取り500万行・書き込み10万行、容量は1DB 500MB・アカウント合計5GBである。
日次上限に達するとD1クエリがエラーとなり、UTC 0時（日本時間9時）にリセットされる。保存済みデータは上限到達だけでは削除されない。
取り込みだけでなく閲覧・既読・保存・期限整理も失敗し得るため、閲覧を維持できる独自のハードキャップとは扱わない。
容量上限は日付が変わっても解消しない。Paidへの変更は行わず、保存状態とバックアップを確認してから容量の対処を判断する。

Cloudflare DashboardのD1のMetricsでDB別の行数・容量、BillingのBillable Usageでアカウント内の合算を確認する。
日次上限到達時のCloudflare標準メールについて、アカウントの連絡先と到達を確認する。
追加の早期警告には利用可能なBilling Notificationsの読み取り・書き込み行数通知を設定し、任意閾値や容量は対応データセットのMonitorsを検討する。
契約・権限・利用可能なデータセットを確認してから設定し、Freeで任意の通知条件が使えることを保証しない。
通知は利用量の可視化であり、消費を停止する制御ではない。アプリのWorkerに監視用APIトークンや通知先を設定する必要はない。

### アプリケーションに残す制御

共通のRSS収集スケジュール、Queue操作の推計予約、ジョブの処理件数、フィード応答サイズと記事件数の上限を維持する。
通常記事は既存の7日保持と期限整理を使い、お気に入り・あとで読むなどで保存した記事を容量の都合だけで無断削除しない。
索引とcontent_hashによる不要な読み書きの削減も維持する。新しいグローバル保存件数制限やPaid向けの予算制御は追加しない。

### 上限エラーの扱い

実際にD1から上限エラーが返った場合、通常のAPIはHTTP 503と固定のエラーコードを返し、画面には日本語の案内を表示する。
一括インポートはHTTP 200で確認済みの部分結果と項目別の上限コードを返し、後続の処理を中断する。
日次読み取り・書き込み上限はそれぞれ `D1_DAILY_READ_LIMIT`、`D1_DAILY_WRITE_LIMIT` とし、通常の503応答には次のUTC 0時までの秒数をRetry-Afterに付ける。
DB容量とアカウント容量の上限は `D1_DATABASE_STORAGE_LIMIT`、`D1_ACCOUNT_STORAGE_LIMIT` とし、日付変更で回復するという案内やRetry-Afterは付けない。
既知のD1エラーだけを分類し、一般のSQLエラーや一時障害を上限超過と決めつけない。

予期しないAPIエラーのログには `requestId` と固定の `category` を記録する。
分類はD1・型・構文・範囲・タイムアウト・未分類に限定し、SQL、URL、例外メッセージや任意の例外名は出力しない。

Collectorは上限エラーをフィードの取得失敗と混同せず、固定の `d1_quota_exceeded` イベントとコードを記録する。
新たな停止状態をDBへ保存せず、既存のQueue再配信上限と次の定期実行によるジョブ修復を維持する。短い間隔での独自再試行は追加しない。
回復後は画面を再読み込みして保存済みの状態と処理結果を確認する。途中で書き込みが成功していた可能性があるため、変更操作を無条件に自動再送しない。

[料金](https://developers.cloudflare.com/d1/platform/pricing/)、[制限](https://developers.cloudflare.com/d1/platform/limits/)、
[Billing通知](https://developers.cloudflare.com/d1/observability/billing/)、[D1エラー](https://developers.cloudflare.com/d1/observability/debug-d1/)、
[Free日次上限の変更](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)を参照する。
Cloudflare側の通知設定、実際の上限到達と解除、実配備は未検証である。

取得失敗は15分→60分→6時間→24時間等へ後退。Retry-Afterがあれば優先し、極端な指定は上限を設ける。購読ごとの取得時間を分散。上限超過フィードは警告し、同じ負荷を無限再試行しない。

## 5. 日常監視

収集の監視はCloudflare標準のObservabilityとAlertsを優先する。Collectorは構造化ログと集約値を出力し、条件評価と通知先の管理はCloudflare側で行う。
WorkerにはWebhook送信、通知の再試行、通知状態を保存するD1への書き込みを持たせない。追加の監視WorkerやAnalytics Engineも導入しない。

### ログと状態API

Collectorの `observability` とLogs・Tracesを有効にし、Logsのサンプリング率を1にする設定をプレビュー・本番で維持する。
`console.log` / `console.error` にJSONオブジェクトを渡し、以下のイベントを記録する。

| イベント               | 内容                                     |
| ---------------------- | ---------------------------------------- |
| `collection_heartbeat` | Cronの起動と予定時刻。DB照会前に記録     |
| `tick_dispatch`        | Queueへのtick投入の成功・失敗            |
| `collection_snapshot`  | 保存済みの集計値。取得失敗時は固定エラー |
| `fetch_result`         | RSS取得の成功・304・失敗・失効           |

集計には `lastTick`、`lastSuccess`、`failingSources`、`maxConsecutiveFailures`、`pendingJobs`、`oldestPendingAgeSeconds`、
`queueBudgetStopped` を含める。時刻はUnix秒、滞留時間は秒とする。
未取得の時刻・滞留時間はnullを保持し、0や正常な状態に置き換えない。
`collection_heartbeat` の `scheduledAt` は予定時刻のUnixミリ秒である。
`collection_snapshot` は成功時に `outcome=success`、取得失敗時に `outcome=failed` と固定の `errorCode` を記録する。
`fetch_result` の `outcome` は `success`、`not_modified`、`failed`、`stale` で、失敗理由は固定の `errorCode` で表す。
集計は現在の毎時tickが処理される前の保存済み状態を含み、現在の収集完了を表すものではない。集計の取得失敗だけでtick投入を止めない。
フィードのURL、タイトル、本文、認証情報、記事・購読先・ジョブの識別子、例外メッセージはこれらのログへ含めない。

`GET /status` の最終成功・最古の未完了ジョブ・連続失敗・Queue予算停止の指標は引き続き確認できる。
RSSの取得失敗をアプリケーションが処理して正常終了した場合、Workerの例外監視だけでは分からないため、`fetch_result` と集計値も監視する。

D1の実際の上限到達は `d1_quota_exceeded` イベントの固定コードで判別する。
APIとCollectorで同じ分類を使い、本文やSQLを記録しない。

### Cloudflare側の設定

1. 対象アカウントのWorkers Logsで `tayori-collector` と `tayori-collector-preview` のログを別々に確認する。
2. **Observability → Alerts → Monitors** でThreshold監視を作成する。最初はEmailを通知先にし、必要ならCloudflareのDestinationsにWebhookを登録する。通知先のURLをWorkerやGitHubのシークレットへ設定する必要はない。
3. 使用するデータセット・列・カスタム属性の実名と型をSQL APIのintrospectionまたは画面で確認する。契約・権限で利用可否が異なるため、一覧に存在するだけで利用可能とは判断しない。
4. アカウントとWorker名で対象を絞り、単一の数値列 `value` を返すクエリを作る。プレビューで通常時・異常時の値を確認してから有効にする。
5. 評価間隔とRepeat notification intervalを指定する。後者の既定値は1時間なので、同じ障害を頻繁に通知しないよう、例えば24時間へ変更する。回復時の評価と通知の動作も試験する。

監視条件の初期案は次のとおりとする。閾値はWorkerの環境変数ではなくMonitor側で設定し、実測から調整する。

| 対象                   | 初期条件・確認方法                                           |
| ---------------------- | ------------------------------------------------------------ |
| Workerの実行失敗       | Workers Issues・実行結果・利用可能な通知を確認               |
| 取得の連続失敗         | `maxConsecutiveFailures >= 3`                                |
| ジョブの滞留           | `pendingJobs > 0` かつ `oldestPendingAgeSeconds >= 10800`    |
| 予算による停止         | `queueBudgetStopped=true`                                    |
| 集計の取得失敗         | `collection_snapshot` かつ `outcome=failed` が評価窓内に存在 |
| Cronの未起動・ログ欠落 | 過去3時間のheartbeat件数が1未満。ゼロ件評価の実証が前提      |

取得の連続失敗・滞留・Queue予算停止の条件には成功した集計値を使う。取得エラーの種別は `fetch_result` で確認する。
D1の上限エラーは `d1_quota_exceeded` と固定の `code` で確認する。日次と容量の区別は「停止と保持」に従う。
Workerの例外やCron・Queueの実行失敗は、利用可能なPlatform Notificationsまたは対応データセットのMonitorを設定する。

SQL例は、対象アカウントで `logs.workersLogs` と `attributes['event']` が利用できることを確認した後に使う。
属性名は実際のログとintrospectionの結果に合わせ、`<ACCOUNT_TAG>` は対象アカウントIDへ置き換える。クエリの末尾にセミコロンを付けない。

```sql
SELECT COUNT(*) AS value
FROM logs.workersLogs
WHERE accountTag = '<ACCOUNT_TAG>'
  AND scriptName = 'tayori-collector'
  AND timestamp >= NOW() - INTERVAL '3' HOUR
  AND attributes['event'] = 'collection_heartbeat'
```

この例はManual time-rangeで評価し、`value < 1` を条件とする。プレビュー環境ではWorker名を `tayori-collector-preview` に置き換える。
Monitorsは「行なし」のクエリ結果では通知しない。`COUNT(*)` が対象0件でも数値0を返し、実際に通知されることを、未起動の検知とは別に試験する。
利用可能なデータセットがない場合やゼロ件評価を実証できない場合、Cron未起動の検知は未対応として扱い、必要なら独立した外部監視を別途検討する。
ログの保存上限、サンプリング、取り込み遅延、権限エラーでも信号は欠落し得るため、ログ欠落をCron停止と断定しない。

集計値は毎時の観測である。評価窓に過去の異常値が残っていれば正常復帰後も条件に該当するため、窓の長さと通知・回復までの遅延を確認する。
日次収集の正常な待機や購読先0件を、最終成功時刻が古いという理由だけで障害にしない。Queue自体の実測滞留とD1の未完了ジョブの滞留は別の指標である。

### 利用枠と運用確認

2026-11-08時点のWorkers Logs Freeは1日20万イベント・3日保持である。アカウント内の他のWorkerと合算し、標準の実行ログとカスタムログを両方数える。
2026-12-01からはObservabilityの新料金へ移行予定で、Freeは1日0.5GBの取り込みと7日保持となる。現在の上限と将来の上限を混同しない。
集計は毎時1回のD1照会を行い、通常は1日24回となる。読み取り行数は対象件数とSQLの集計に依存するため実測する。
監視自体のD1照会、ログ量、利用可能な通知・データセットを確認し、有料機能の追加を前提にしない。

導入時は通常取得・304・連続失敗・滞留・予算停止・回復をテスト用データで確認し、ログの属性、Monitorの評価、通知到達を照合する。
通知先のテスト送信に加えて条件を実際に成立させた通知と再通知間隔を確認する。Cron欠落と集計取得失敗も別々に試験する。
原因調査はWorkerの実行結果、Queue、D1の状態APIと保存済み状態から行い、通知を止めるためだけに保存記事を削除しない。
実環境のデータセット照会、Monitor作成、通知送信の実施状況は未確認である。これらの実証が済むまで通知が運用開始済みとは扱わない。Preview配備手順は[CI/CD設計](11-ci-cd.md)を参照する。

公式資料: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、
[Monitors](https://developers.cloudflare.com/notifications/monitors/)、[SQL API datasets](https://developers.cloudflare.com/analytics/sql-api/datasets/)、
[Alerts設定](https://developers.cloudflare.com/notifications/get-started/)、[Observability料金](https://developers.cloudflare.com/observability/pricing/)。

サイドバーの各フィードに未読数を表示し、「取得状況」を開くと停止状態、最終確認、最終成功、次回対象時刻、連続失敗数とエラーの説明・コードを確認できる。フォルダ内と未分類の両方に表示する。
更新ボタンや記事状態の変更後にD1の保存済み情報を再取得する。初回登録直後は「初回取得の確認待ち」となり、RSS取得完了後の情報は画面を更新して確認する。全体の「収集スケジューラー最終実行」は個別フィードの取得完了ではない。

## 6. バックアップと復元

D1 Time Travel は自動で有効になり、Workers Free では過去 7 日間の任意の分に復元できる。記事の 7 日保持とは別の機能である。
Workers Paid では 30 日間保持される。詳細は [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) と
[プラン別の制限](https://developers.cloudflare.com/d1/platform/limits/)を参照する。

障害や誤操作が発生した場合は、履歴の保持期間内で正常だった時点を特定し、Time Travel で復元する。復元は対象 DB を上書きし、
進行中のクエリとトランザクションを中断する。復元後は指定時点以降の変更が失われる。実 D1 での復元演習の実施状況と復旧時間は未確認である。

1. アプリへの書き込み、定期収集、Queue の producer と consumer を停止し、処理中の実行が終了したことを確認する。
   復元後に旧 Queue の fetch と tick のメッセージが流れないよう隔離する。
2. 対象 DB と復元時点を確認し、[Time Travel の復元手順](https://developers.cloudflare.com/d1/reference/time-travel/#restore-a-database)に従って復元する。
   復元後に表示される復元前の bookmark を記録する。
3. 収集と Queue を停止したまま `scripts/restore-d1-safety.sql` を対象 DB に適用する。復元された未完了ジョブを失敗扱いにし、購読先の generation を更新する。
   復元時点以降のジョブは DB に含まれないため、generation の更新だけに頼らず旧 Queue の隔離を維持する。
4. `PRAGMA quick_check` が `ok`、`PRAGMA foreign_key_check` の結果が空であることを確認する。購読先や記事の件数、既読・保存状態、必要な migration も確認する。
   `quick_check` は UNIQUE 制約とインデックスの内容の一致を検査しない。
5. 空の新しい Queue を作成し、メッセージの配信を一時停止する。旧 Queue は配信停止のまま残し、未処理の fetch と tick を新 Queue に移さない。
   アプリへの書き込みと定期収集を停止したまま、`apps/app/cloudflare.config.ts` と `apps/collector/cloudflare.config.ts` の Queue 名を同じ新 Queue 名に変更する。
   変更をコミットし、後続のリリースタグが新 Queue 名を含むコミットを参照するようにする。
   collector の `JOBS` binding と Queue trigger の両方が新 Queue を指すことを確認する。定期収集が切り替え途中に再開しないよう、collector の scheduled trigger を一時的に無効にする。
6. 両 Worker をデプロイし、アプリと collector の producer、および collector の consumer が新 Queue を参照していることを確認する。
   新 Queue の配信とアプリへの書き込みを再開する。collector の scheduled trigger を元に戻して再デプロイし、定期収集を再開する。新しいジョブが処理されることを確認し、復元時点と検証結果を記録する。

7 日を超える長期保管が必要になった場合は、D1 の SQL を非公開の R2 バケットに定期退避する方法を検討する。[Cloudflare の Workflows による実装例](https://developers.cloudflare.com/workflows/examples/backup-d1/)を参照し、
保持期間、アクセス制御、監視、費用、復元演習を検討する。R2 への自動退避は実装・設定していない。

## 7. 費用の境界

独自ドメイン購入料、既存契約の料金、端末/通信料は本アプリのCloudflare使用料とは別。既存ドメインがなければworkers.dev＋Accessを候補とする。公開前にFree契約・支払設定・既存使用量を確認する。
有料製品や外部クラウドは必要性が出るまで追加しない。

## RSS収集設定

サイドバーの「RSS収集設定」から、全購読先に共通する設定を変更できる。保存期間は7日固定で、この設定からは変更しない。

- 取得間隔: 1・2・3・6・12・24時間。未設定時は1時間。
- 毎日の実行時刻: 日本時間の0:00〜23:00、1時間単位。
- タイムゾーン: Asia/Tokyo固定。

画面には保存済み設定と、有効な購読先のうち最も早い次回取得予定を表示する。編集値は保存成功まで確定表示せず、保存失敗時は入力値を保持してエラーを表示する。ダイアログを開き直すとD1から設定を取得するため、
別端末で保存した設定も確認できる。

記事一覧の「更新」、ページ表示、共通の収集設定の保存ではRSSを即時取得せず、新規取得ジョブも作成しない。新規購読時と購読先URLの変更時には取得ジョブを投入する。時間境界や失敗時の扱いは[収集スケジュールの適用](06-sequences.md#収集スケジュールの適用)を参照する。

## 一時停止状態の廃止

移行前に `sources` の `status = 'paused'` が存在しないことを確認する。一時停止中の購読先が見つかった場合、マイグレーションは失敗し、自動で再開しない。
旧バージョンのローカル開発用サンプルは有効に戻し、取得予定を将来に設定する。

## 購読先の設定

サイドバーの購読先にある「購読設定」から、表示名、所属フォルダ、「RSS / Atom URL」を変更できる。「未分類」を選ぶとフォルダから外れる。通常の保存失敗では入力内容を残すため、表示されたエラーを確認して再操作する。

URLの保存後は新しいURLの取得ジョブをキューに投入する。投入に失敗した場合は定期収集で再試行する。既存の記事・既読・保存状態は維持するが、配信元の記事IDや記事URLが変わると、
同じ内容でも新しい記事として登録される場合がある。新URLの失敗は購読先の取得状態表示で確認する。APIの版指定や旧ジョブの扱いは[API設計の「購読先の更新」](05-api.md#購読先の更新)を参照する。

他端末との保存競合では一覧を再取得し、古い入力の再保存・購読解除を無効にする。設定を閉じ、最新の内容で開き直してから再操作する。再取得は現在の画面へ結果を適用できた場合だけ成功とし、通信失敗や古い応答の破棄はダイアログ内にも失敗を表示する。
この場合は一覧を更新してから開き直す。

「購読解除…」で影響を確認し、確認欄を選んでから解除する。解除した購読先はサイドバーと以後の収集対象から外れる。既存の記事と既読・保存状態はその場では削除しない。通常記事は保存期限まで、
お気に入り・あとで読むなどで保持する記事は既存の保持条件に従い、「すべての記事」などから閲覧できる。

## 画面復帰時の状態同期

画面が表示状態へ戻るかウィンドウにフォーカスが戻ると、D1に保存済みの記事・購読先・フォルダ・全体状態を再取得する。表示中も5分ごとに再取得し、非表示中は自動取得しない。
近接するfocus/visibilityイベントは3秒の間隔でまとめる。RSSの即時取得やQueueジョブ作成は行わない。

書き込み、OPML処理、記事の一括操作、設定ダイアログの編集中は自動同期を待機させる。自動再取得中に書き込みや画面切替が始まった場合は古い応答を反映しない。読み込み済みの記事件数を目安に先頭からページを取り直し、
有効な次ページカーソルを更新する。選択IDは取得後も存在するものを維持する。他端末で選択中フォルダが削除されたり購読が解除された場合は全記事へ戻る。失敗時は表示中の記事を維持し、エラーを表示する。
画面を閉じるとタイマーとイベント監視を解除する。

## ボード廃止前の確認

`0004_remove_boards.sql` はボードと記事の所属情報を削除する。以下の SQL で、ボード所属以外に保存指定のない記事を確認する。期限切れの記事は移行後に一覧から除外され、次の整理処理で削除対象になる。必要な記事は移行前にお気に入りまたはあとで読むに指定する。

```sql
SELECT DISTINCT a.id, a.title, a.url, a.expires_at
FROM articles a JOIN board_articles ba ON ba.article_id = a.id
WHERE a.starred = 0 AND a.read_later = 0;
```

このマイグレーションは旧 Worker と互換性がないため、プレビューと本番のそれぞれで保守停止を設ける。
プレビューは main へのマージで自動配備されるため、マージ前にプレビューの停止準備を完了する。本番はタグ作成前に同様に準備する。

1. 対象環境のすべての公開経路と直接アクセス可能な経路を遮断し、読み取りを含む旧 App API への要求を停止する。実行中の要求が終了したことを確認する。
2. 対象環境の Cron と Queue consumer を停止し、実行中の収集処理の終了を確認する。Queue の新規投入と配信も隔離し、保留メッセージが旧 collector で処理されないようにする。停止と隔離を確認できなければ先へ進まない。
3. 対象 DB の SQL バックアップを作成し、上記の確認と必要な保存指定を済ませる。停止前に指定できなかった記事は、停止中に対象 DB で下記の保存状態更新を行う。
4. GitHub Actions の通常の Preview または Release ワークフローでマイグレーション、App、collector を順に更新する。Actions が利用できない間は保守停止を維持し、配備を開始しない。
5. 両 Worker の配備結果と対象 DB、記事・保存状態を確認する。配備時に Cron や consumer が再設定された場合も、確認が終わるまで Queue の隔離を維持する。
6. 成功を確認後、Queue の隔離と Cron・consumer の停止を解除し、公開経路を再開する。失敗時は停止を維持し、旧 Worker と DB の互換性を確認してから復旧する。

保存状態を直接更新する場合は、`対象の記事ID` を実際の記事 ID に置き換え、保存状態とともに `version` と `updated_at` を同じ UPDATE で更新する。
以下はお気に入りに指定する例で、あとで読むに指定する場合は `starred = 1` を `read_later = 1` に置き換える。指定しない保存状態は維持する。

```sql
UPDATE articles
SET starred = 1, version = version + 1, updated_at = unixepoch()
WHERE id = '対象の記事ID';
```

版を更新することで、停止前の古い `expectedVersion` による上書きを防ぐ。この手順の実環境での実施状況は未確認である。

バックアップから旧スキーマを復元した場合は、復元先 DB で冒頭のボード所属記事を抽出する SELECT を実行し、保持したい記事の ID を確認する。
期限切れ記事は現行 UI の一覧に表示されない。記事が DB に残っていれば `PATCH /articles/:id` でも保存状態を更新できるが、
この手順ではマイグレーション前に復元先 DB で対象の ID を指定し、上記の保存状態更新を行う。その後、マイグレーションを適用する。

復元先の `version` を 1 増やすだけでは、復元前のクライアントが持つ版と一致する場合がある。再開前にすべてのクライアントで古い画面と未送信・再送待ちの更新を破棄し、
最新状態を再取得する。オフライン端末もアクセス再開前に同じ操作を行う。すべての端末の状態を破棄できると確認できなければ書き込みを再開しない。
