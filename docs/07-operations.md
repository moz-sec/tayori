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

1メッセージ64KB未満、通常成功=write/read/deleteの3操作。tickもカウントする。sendBatchしてもメッセージ単位の操作数は減らない。

| ケース          | fetch/日 | tick/日 | 基本操作/日 |
| --------------- | -------: | ------: | ----------: |
| 50購読先・60分  |    1,200 |     288 |       4,464 |
| 50購読先・30分  |    2,400 |     288 |       8,064 |
| 100購読先・60分 |    2,400 |     288 |       8,064 |
| 100購読先・30分 |    4,800 |     288 |      15,264 |

初期は50件・60分を採用。30分一律にしない。再試行、重複送信、初回移行、障害回復分は表に含まない。

アプリ側では、1日あたりの操作数を推計8,000回以下に抑える。tick は再試行1回分を含む 4×288=1,152 操作をあらかじめ差し引き、fetch の送信1回につき4操作を原子的に予約する。再送時にも予約し、
予算が残っていない場合は予約記録を翌 UTC 日に持ち越す。消費量を少なく見積もらないよう、送信に失敗しても予約分を安易に払い戻さない。

これは概算に基づく制御であり、重複配信、日をまたぐ処理、他のアプリの使用量まで含めて課金を厳密に制御するものではない。Cloudflare の実測値も確認し、共有枠に合わせて8,000回の上限をさらに下げる。

## 3. D1と容量の試算

仮定: 50購読先×10新着/日=500記事/日、保存レコード平均4KiB（索引等を含む仮置き）。通常記事7日分は約13.7MiB。お気に入り等は別途累積する。

記事識別情報を保存する `item_keys` が1件あたり200Bと仮定すると、年間で約36.5MB増える。実際の容量は SQLite のページや索引によって変わるため、DB のサイズを定期的に確認する。記事を7日間保持しても、DB
全体の容量は一定にならない。

fetch 関連で1回あたり20行、新着記事と索引・記事識別情報で1件あたり10行、期限切れ記事の削除で1件あたり10行を書き込むと仮定する。この場合、1,200×20+500×10+500×10で1日あたり34,000行になる。tick、
API、ボード、ジョブ整理による書き込みは別途加算する。実測した `meta.rows_written` に合わせて係数を見直す。HTTP 304 の場合も取得状態を更新するため、書き込みが発生する。

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

実際にD1から上限エラーが返った場合、APIはHTTP 503と固定のエラーコードを返し、画面には日本語の案内を表示する。
日次読み取り・書き込み上限はそれぞれ `D1_DAILY_READ_LIMIT`、`D1_DAILY_WRITE_LIMIT` とし、次のUTC 0時までの秒数をRetry-Afterに付ける。
DB容量とアカウント容量の上限は `D1_DATABASE_STORAGE_LIMIT`、`D1_ACCOUNT_STORAGE_LIMIT` とし、日付変更で回復するという案内やRetry-Afterは付けない。
既知のD1エラーだけを分類し、一般のSQLエラーや一時障害を上限超過と決めつけない。

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
実環境のデータセット照会、Monitor作成、通知送信、配備は未実施である。GitHub Actionsも停止中のため、これらの実証が済むまで通知が運用開始済みとは扱わない。

公式資料: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、
[Monitors](https://developers.cloudflare.com/notifications/monitors/)、[SQL API datasets](https://developers.cloudflare.com/analytics/sql-api/datasets/)、
[Alerts設定](https://developers.cloudflare.com/notifications/get-started/)、[Observability料金](https://developers.cloudflare.com/observability/pricing/)。

サイドバーの各フィードに未読数を表示し、「取得状況」を開くと停止状態、最終確認、最終成功、次回対象時刻、連続失敗数とエラーの説明・コードを確認できる。フォルダ内と未分類の両方に表示する。
更新ボタンや記事状態の変更後にD1の保存済み情報を再取得する。初回登録直後は「初回取得の確認待ち」となり、RSS取得完了後の情報は画面を更新して確認する。全体の「収集スケジューラー最終実行」は個別フィードの取得完了ではない。

## 6. バックアップと復元

- D1 Time Travel 7日を短期事故復旧に使う。記事の7日保持とは別機能。
- 週1回とマイグレーション前にD1をSQL exportし、本人のPC等へ保存。自動R2バックアップは初期スコープ外。
- アプリのランタイムはCloudflare内で完結し、バックアップ保管先だけを手元にする。
- エクスポートは書込処理へ影響し得るため、収集とUI更新を一時停止して実施する。外部共有しない。
- 世代保持は4週を設計案とする。7日経過記事がバックアップに残る可能性を明示する。

復元手順: 収集を停止し、現状を退避する。次に、別の DB へ SQL をインポートし、件数、制約、記事の状態を確認する。ジョブを無効にして `generation` を更新した後、Web と collector の binding
を同じ復元先 DB に切り替える。動作を確認してから収集を再開する。失敗した場合は旧 DB に戻す。OPML だけでは既読状態、ボード、記事識別情報を復元できない。

目標はTime Travelが利用可能な通常事故では直前まで復旧、外部SQLのみなら最大7日分の損失。復旧時間は個人運用で固定保証せず、初回リリース前に復元を実演する。

## 7. 費用の境界

独自ドメイン購入料、既存契約の料金、端末/通信料は本アプリのCloudflare使用料とは別。既存ドメインがなければworkers.dev＋Accessを候補とする。公開前にFree契約・支払設定・既存使用量を確認する。
有料製品や外部クラウドは必要性が出るまで追加しない。

## 購読先の設定

サイドバーの購読先にある「購読設定」から、表示名、所属フォルダ、「RSS / Atom URL」を変更できる。「未分類」を選ぶとフォルダから外れる。通常の保存失敗では入力内容を残すため、表示されたエラーを確認して再操作する。

URLの保存ではすぐに取得せず、共通の収集設定に従って次回の定期収集を待つ。一時停止中の購読先はURL変更後も停止したままになる。既存の記事・既読・保存状態は維持するが、配信元の記事IDや記事URLが変わると、
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
