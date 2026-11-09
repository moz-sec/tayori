# 開発・検証計画

本書では、初期実装と今後の検証手順を記録する。UI/API、RSS 収集、Access JWT の検証、OPML、D1 schema は実装済み。実環境での検証は本書のリリース手順に従って確認する。

## 1. 推奨技術

TypeScript、React、Vite、Tailwind CSS、daisyUI、Hono、Workers、D1（SQLマイグレーション）、Queues、Access。RSS/Atom解析はfast-xml-parserを利用する。
GoやVMは使わない。

```text
tayori/
├── apps/
│   ├── app/              # Vite + Hono Web/API Worker
│   └── collector/        # scheduled / queue handlers
├── packages/shared/      # アプリ間共有の型・値
├── migrations/           # D1 SQL migrations
├── docs/
├── icon/
└── package.json         # npm workspaces
```

## 2. 環境と設定

- ローカルはVite plugin/WorkerdでWorkerを起動し、フィードパーサーはフィクスチャでテストする。D1・Queueの統合動作はまだ十分に検証していない。
- 本番用と検証用では DB と Queue を分ける。ただし、無料枠の使用量は合算される。Preview collectorにも毎時Cronを設定している。
- app binding: DB、JOBS と静的アセット。collector binding: DB、JOBS。
- collectorに公開HTTP経路は設けない。scheduledからのみtick投入。
- 本番認証は`ALLOWED_EMAIL`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`を秘密として設定。JWT・秘密はGitに保存しない。
- ローカル認証代替はローカルホスト向けに限定する。実環境での拒否ケースは未確認。
- SQL migration、Worker設定、lockfileをGit管理。Terraformは初期必須にしない。

各 Worker の `cloudflare.config.ts` を Cloudflare 設定の唯一の実行元とする。npm workspaces では `cf build` が Vite plugin を見つけられないため、
開発とビルドには Vite を使い、成果物は `cf deploy --prebuilt` でデプロイする。D1 マイグレーションや Queue などのリソース管理にも `cf` コマンドを使う。`cf` はベータ版のため、CLI
や設定形式を更新するときは公式情報を確認する。現時点で `cf` が対応していないログの tail や単独の secret 更新が必要な場合に限り、Wrangler を補助的に使う。

既存D1への収集設定導入には `migrations/0002_collection_schedule.sql` をApp・Collectorの更新前に適用する。失敗中の既存購読先は、その時点の `next_fetch_at` を待機期限として引き継ぐ。
ローカルでは `npm run db:migrate:local`、対象環境では環境別のマイグレーション手順を使い、Previewと本番のDB IDを混在させない。設定が未保存または不正な場合は毎時間隔で動作する。

## 3. 実装順序

| 段階     | 成果                                               | 次へ進む条件                                 |
| -------- | -------------------------------------------------- | -------------------------------------------- |
| 初期実装 | UI/API、Queue収集、OPML、7日整理                   | 型チェック、パーサーテスト、Workerビルド成功 |
| 0        | FreeでQueue consumer、Cron、D1、Accessを小さく実証 | 実行制限・CPU・認証を確認                    |
| 1        | フォルダ/購読先/記事のDBとAPI                      | 制約・期限・重複排除テスト成功               |
| 2        | tick→fetch収集と予算ガード                         | 304・200・失敗・重複配信を検証               |
| 3        | レスポンシブUI、既読、保存                         | PC/スマホから同じ状態を確認                  |
| 4        | OPML移行と7日整理                                  | 移行再開、期限削除、再出現防止を検証         |
| 5        | 実際の購読先50件、バックアップ復元                 | 無料枠使用量と復旧手順を記録                 |

フェーズ0でQueue CPUや無料枠が成立しない場合、Cloudflare内で処理分割・頻度低下を再設計する。自動でPaid/GCPへ切り替えない。

## 4. 必須テスト

| 対象         | 重要なケース                                                            |
| ------------ | ----------------------------------------------------------------------- |
| 認証         | 未設定、偽造、期限切れ、異なるaud/issuer/email、workers.dev/preview迂回 |
| API          | 他Origin、型/長さ不正、SQL文字列入力、競合version、再送                 |
| XML          | RSS2、Atom、名前空間、CDATA、日本語、空/不正/過大XML、DTD拒否           |
| ネットワーク | 304、ETagなし、429 Retry-After、5xx、timeout、redirect loop、内部URL    |
| 収集         | 送信前停止、送信後DB記録失敗、重複配信、古いgeneration、保存後ack前停止 |
| D1           | 50クエリ/100 bind以内、batchロールバック、パラメータ化、全文走査の有無  |
| 保存         | 7日直前/直後、未読期限、保存例外、解除後期限、保存と削除の競合          |
| 重複         | 同GUID更新、同URL、ID欠損、期限削除後再出現、購読解除→再登録            |
| フォルダ     | 10個、階層移動、循環拒否、削除で親へ移動                                |
| OPML         | 階層、重複URL、同名フォルダ、不正URL、中断再開、再export                |
| UI           | 375px幅とPC、キーボード、空状態、ログイン切れ、保存失敗、期限切れ表示   |
| 復旧         | 別D1への復元、記事識別情報の保持、旧Queueメッセージの拒否               |

ローカル環境だけでは CPU や本番環境の制限内で動くことを確認できない。実際の Free 環境では、代表的な10〜20フィードから始め、段階的に50フィードまで増やす。7日間の保持は、時刻を固定した自動テストと8日程度の実運用で確認する。

### 実ブラウザーE2E

#### 実行方法

リポジトリの `.nvmrc` に合わせてNodeを準備し、ルートで次を実行する。

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

LinuxのCIではブラウザーのシステム依存も `npx playwright install --with-deps chromium` で導入する。
インストール済みChromeを使う場合は `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` でも実行できる。

テストは `127.0.0.1:4173` の専用Viteサーバーを起動・終了する。このポートで別のサーバーが動いていれば停止してから実行する。既存サーバーを再利用しないため、普段の開発DBや別アプリを誤って操作しない。

#### データ・認証・外部通信

- `vite.e2e.config.ts` は実際のApp APIをWorkers runtimeで動かし、D1とQueueはローカルでエミュレートする。D1はメモリー内だけに保持し、通常の `.cloudflare/state` やPreview/Productionには接続しない。
- `e2e/worker.ts` だけにある `/__e2e/reset` で各テスト前に全マイグレーションを適用し、3フォルダ・1購読・55記事を準備する。テストは1ワーカーで直列に実行する。
- resetルートはこのテスト専用entrypoint以外に組み込まれず、ローカルホスト・POST・同一Originだけを受け付ける。本番Workerは `src/index.ts` のままであり、このルートを持たない。
- 認証には既存のローカルホスト用認証を使う。設定読み込みに必要なAccess変数はテスト用ダミー値を渡し、本番の認証情報は不要。Access JWTの許可・拒否・設定不足はAPIテストと実環境の検証で扱う。
- RSSの収集実行や外部サイトの閲覧は行わない。登録による初回ジョブはローカルQueueに送られ、Collectorは起動しない。

#### 検証範囲と役割分担

Issue #38では利用者がブラウザーから行う次の操作を確認する。

1. 購読の登録、表示名・URL編集、フォルダ移動、チェックボックスで確認した解除、解除後の既存記事保持
2. フォルダ作成、折りたたみと再読み込み後の保持、同じ親の中での並べ替え、子・親フォルダ削除時の購読先移動
3. 記事選択、まとめて既読、あとで読む・お気に入り、50件から55件へのページング、再読み込み後の状態
4. 実ブラウザーのフォーカス復帰、Escapeでのダイアログ終了、別画面変更の画面復帰時同期
5. 収集設定の毎日指定保存と再読み込み、間隔指定の保存失敗時の入力保持・保存済み表示維持、再試行
6. 購読URL編集の競合後に最新一覧を読み込み、古い入力を再保存させず、開き直した画面へ最新URLを表示
7. 小さい画面でサイドバーをスクロールし、下部の収集設定へ到達できること

Issue #21のAPI/DB結合テストはSQL制約、競合、不正入力、保持・原子性を受け持つ。
関数の細かな境界条件は単体テストで扱い、E2Eに重複して追加しない。
収集設定は、全マイグレーション適用後のSQLiteを使うテストでAPI保存・ロールバック・入力検証・時間境界・実行中の設定変更・再試行・重複tickを確認する。
OPMLの階層・部分失敗は既存のAPI・関数テストで扱う。
Preview/Productionの実認証・実収集・デプロイ確認はIssue #20の範囲。

#### 待機と失敗調査

利用者向けのrole、ラベル、記事タイトルで要素を特定する。
画面表示にはPlaywrightの再試行付きassertion、状態確認にはAPI応答または `expect.poll` を使い、固定時間の待機を置かない。
画面復帰テストはPlaywright clockでフォーカスイベントのクールダウンだけを進め、実ブラウザーのタブを切り替える。
headless Chromiumはタブを常に表示状態として扱うため、切り替え後のfocusイベントを明示的に発火し、ブラウザーの実際のイベント処理・API再取得・画面反映を検証する。
ダイアログ終了時のフォーカス復帰は実際のactiveElementで確認する。

失敗時はスクリーンショットとtraceを `output/playwright/test-results` に残す。HTMLレポートは `apps/app/playwright-report`。次で確認できる。

```sh
npx playwright show-report apps/app/playwright-report
npx playwright show-trace output/playwright/test-results/<失敗したテスト>/trace.zip
```

CIは既存の型チェック・単体/結合テスト・ビルドに加えてChromiumのこの7フローだけを実行し、失敗時の成果物を7日間保存する。

## 5. リリース手順

1. 対象Cloudflareアカウント、Free契約、既存使用量、許可メールを確認。
2. D1/Queueを作成し、マイグレーションとbindingを設定。
3. Accessを設定し、認証未設定時は拒否するWebをデプロイ。
4. 別ブラウザの未ログイン・別ユーザー・previewを含めアクセス試験。
5. collectorをデプロイし、少数フィードでCPU/DB/Queueを実測。
6. OPMLで約50件を段階投入。Cron有効化後の操作数・遅延を確認。
7. バックアップ復元を検証し、デプロイID・DB ID・テスト結果を記録。

## 6. 着手時の未決事項

Cloudflareアカウント、本人メール、URL/ドメイン、OPML実データ、採用アイコン、保存記事の将来容量方針。本書作成時点ではクラウドにリソースを作成していない。
