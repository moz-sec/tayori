# Cloudflareアーキテクチャ

Cloudflareの制限値は[無料枠・運用設計](07-operations.md)、配備手順は[CI/CD設計](11-ci-cd.md)を参照する。

## 1. システム構成

```mermaid
flowchart LR
    U["本人のPC / スマートフォン"] --> A["Cloudflare Access"]
    subgraph CF["Cloudflare / Free前提"]
        A --> W["tayori-app Worker
認証・Hono API"]
        W --> S["Static Assets
React + daisyUI"]
        W <--> D[("D1
記事・購読・状態・ジョブ")]
        C["Cron / 毎時"] --> H["collector scheduled
集計・tick送信"]
        H --> Q["Queues
tayori-jobs"]
        Q --> F["collector queue
tick / fetch"]
        F -->|"fetchジョブ送信"| Q
        F <--> D
    end
    F -->|"条件付きGET"| E["外部RSS / Atom"]
    O["cf CLI"] -. "SQL export / restore" .-> D
    O --> B["D1 Time Travel"]
```

| リソース                | 責務                                                           |
| ----------------------- | -------------------------------------------------------------- |
| tayori-app Worker       | API、Access JWT確認、Static Assets経由のReact UI配信           |
| tayori-collector Worker | scheduledは監視集計とtick送信。queueで配信対象選定・取得・整理 |
| D1: tayori-db           | 購読・記事・既読・保存・収集ジョブ・予算を集約するデータベース |
| Queues: tayori-jobs     | tick / fetchメッセージ。本文を入れない                         |
| Cloudflare Access       | 通信元を制限                                                   |

Web UI と API は同じオリジンで提供する。
Workers Static Assets を使い、Pages には配置しない。
API はすべてのリクエストで Access JWT を検証する。
workers.dev 上の静的アセット自体は Access で保護されない可能性があるため、公開前に Access で保護したカスタムホスト名を用意する。

## 2. Cronの役割を限定

FreeのHTTP・Cron CPUは10msであり、XML解析やOPML一括処理をここへ集めない。
Cronは毎時、監視用のD1集計とtickメッセージの送信を行う。
収集対象のD1検索、ジョブ作成、期限整理はQueue consumerで行う。

Queues公式制限ページは保持期間を除きFree/Paid共通とし、consumerの標準CPU上限30秒を記載している。一方Workers一般ページにはPaid向けCPU設定の説明もあるため、
**Freeアカウント上のconsumer実行と設定の受理を最初に実証する**。
[Workers制限](https://developers.cloudflare.com/workers/platform/limits/) /
[Queues制限](https://developers.cloudflare.com/queues/platform/limits/)

## 3. Queue設計

- 1つのQueueを使い、`type: tick | fetch` と `schemaVersion: 1` で処理を分岐。
- `tick`: 毎時投入。期限切れジョブ回収、取得期限の購読先を1ページ最大10件ずつ選定、期限切れ記事の小分け整理。必要に応じて継続用tickを送信する。
- `fetch`: `jobId, sourceId, generation` を持つ。1メッセージ1購読先。
- 初期consumer batch sizeは1、concurrencyは1。アプリの取得タイムアウト20秒、全処理目標60秒以内。少数規模では並列度より整合性を優先。
- 技術障害のQueue再試行は最大1回を設計案とする。429/5xxなど既知の取得失敗はD1に次回予定を記録してackする。
- DLQは初期には置かない。消失・保持期限切れはD1の未完了ジョブから再作成する。
- 重複配信と順序入れ替わりを前提とする。メモリ上のフラグをロックに使わない。

## 4. D1とQueue間の整合性

D1 への書き込みと Queue への送信を1つのトランザクションにまとめられないため、D1 の `fetch_jobs` に送信待ちジョブを記録する。

1. tick処理はD1の条件付き更新とbatchでジョブを作成し、次回予定を更新する。対象が取得済み/停止中なら作成しない。送信前に日次予算を予約する。
2. 未送信ジョブを Queue へ送る。送信に成功したら、状態を `sent` に更新する。
3. 送信前の停止なら次tickで再送。送信成功後の記録失敗なら同じjobIdで重複送信され得る。
4. consumerはD1でジョブを条件付きclaimし、leaseとgenerationを取得。完了・古いgenerationは処理しない。
5. 記事書込と最終状態変更は有効なgenerationを条件に実施し、古いconsumerの更新を拒否。
6. 保存成功後にack。保存後ack前の停止でも、再配信は完了記録により無害になる。

D1 batchの原子性だけでは競合防止にならない。各更新の条件、変更件数、予約失敗時のロールバックを結合テストする。
[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## 5. RSS取得

HTTP(S)の公開URLのみ。URLとリダイレクト先を検証し、認証付きURL・既知の内部IP・localhostを拒否する。DNS再束縛を含む制約は残るため、取得対象の検証は継続課題とする。
公開のURL取得プロキシとしてAPIを提供しない。

- ETag / Last-Modifiedを購読先ごとに保存し、条件付きGET。
- 304では記事解析なし。200ではRSS/Atomを解析し、安定キーで重複排除。
- 展開後本文2MiB、リダイレクト3回、記事200件/応答、文字列上限を設定案とする。
- 上限超過・不正XML時はエラーにし、ETagを更新しない。黙って切り捨てて成功扱いしない。
- 保存はパラメータ上限と50クエリ/実行に合わせた複数行INSERT。収まらない処理はチェックポイントを伴って分割する。
- 分割書込は冪等にし、全記事保存完了後にだけ新ETag・Last-Modified・成功時刻を確定。
- HTMLを安全なプレーンテキスト要約へ変換。外部画像は初期表示で自動ロードしない。

## 6. 認証と公開経路

AccessでUIとAPI全体を保護する方針。メールPINを初期候補とする。API Workerは署名・issuer・audience・期限・本人の識別を確認し、未設定/無効時は拒否する。実環境の設定と保護範囲は未確認。
検証済みのプラットフォームidentity機能を使う場合も同じ受け入れ条件を満たす。

静的アセットはWorkerを経由せず配信し、APIのみWorkerで認証する。静的アセットを含む公開経路のAccess保護は別途確認する。collectorのHTTP公開は無効化し、public
route・workers.dev・preview経由の収集起動を作らない。

Cookie認証の更新APIは同一Origin確認、JSON Content-Type、CSRF対策を実施。APIレスポンスはprivate/no-store。秘密鍵・APIトークンをブラウザへ渡さない。
