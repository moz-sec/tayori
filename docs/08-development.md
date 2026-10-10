# 開発・検証計画

本書では、初期実装と今後の検証手順を記録する。UI/API、RSS 収集、Access JWT の検証、OPML、D1 schema は実装済み。本番 Cloudflare リソースの作成、実際の購読先を使った試験、バックアップからの復元はまだ行っていない。

## 1. 推奨技術

TypeScript、React、Vite、Tailwind CSS、daisyUI、Hono、Workers、D1（SQLマイグレーション）、Queues、Access。RSS/Atom解析はfast-xml-parserを利用する。GoやVMは使わない。

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
- 本番用と検証用では DB と Queue を分ける。ただし、無料枠の使用量は合算される。検証環境では通常 Cron を無効にする。
- app binding: DB と静的アセット。collector binding: DB, JOBS。
- collectorに公開HTTP経路は設けない。scheduledからのみtick投入。
- 本番認証は`ALLOWED_EMAIL`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`を秘密として設定。JWT・秘密はGitに保存しない。
- ローカル認証代替は専用設定に限定。本番ビルド/設定検証で代替認証が有効ならデプロイを失敗させる。
- SQL migration、Worker設定、lockfileをGit管理。Terraformは初期必須にしない。

各 Worker の `cloudflare.config.ts` を Cloudflare 設定の唯一の実行元とする。npm workspaces では `cf build` が Vite plugin を見つけられないため、開発とビルドには Vite を使い、成果物は `cf deploy --prebuilt` でデプロイする。D1 マイグレーションや Queue などのリソース管理にも `cf` コマンドを使う。`cf` はベータ版のため、CLI や設定形式を更新するときは公式情報を確認する。現時点で `cf` が対応していないログの tail や単独の secret 更新が必要な場合に限り、Wrangler を補助的に使う。

## 3. 実装順序

| 段階 | 成果 | 次へ進む条件 |
|---|---|---|
| 初期実装 | UI/API、Queue収集、OPML、7日整理 | 型チェック、パーサーテスト、Workerビルド成功 |
| 0 | FreeでQueue consumer、Cron、D1、Accessを小さく実証 | 実行制限・CPU・認証を確認 |
| 1 | フォルダ/購読先/記事のDBとAPI | 制約・期限・重複排除テスト成功 |
| 2 | tick→fetch収集と予算ガード | 304・200・失敗・重複配信を検証 |
| 3 | レスポンシブUI、既読、保存、ボード | PC/スマホから同じ状態を確認 |
| 4 | OPML移行と7日整理 | 移行再開、期限削除、再出現防止を検証 |
| 5 | 実際の購読先50件、バックアップ復元 | 無料枠使用量と復旧手順を記録 |

フェーズ0でQueue CPUや無料枠が成立しない場合、Cloudflare内で処理分割・頻度低下を再設計する。自動でPaid/GCPへ切り替えない。

## 4. 必須テスト

| 対象 | 重要なケース |
|---|---|
| 認証 | 未設定、偽造、期限切れ、異なるaud/issuer/email、workers.dev/preview迂回 |
| API | 他Origin、型/長さ不正、SQL文字列入力、競合version、再送 |
| XML | RSS2、Atom、名前空間、CDATA、日本語、空/不正/過大XML、DTD拒否 |
| ネットワーク | 304、ETagなし、429 Retry-After、5xx、timeout、redirect loop、内部URL |
| 収集 | 送信前停止、送信後DB記録失敗、重複配信、古いgeneration、保存後ack前停止 |
| D1 | 50クエリ/100 bind以内、batchロールバック、パラメータ化、全文走査の有無 |
| 保存 | 7日直前/直後、未読期限、保存例外、解除後期限、保存と削除の競合 |
| 重複 | 同GUID更新、同URL、ID欠損、期限削除後再出現、購読解除→再登録 |
| フォルダ | 10個、階層移動、循環拒否、削除で親へ移動 |
| ボード | 4個以上、複数保存、削除時の保持判定 |
| OPML | 階層、重複URL、同名フォルダ、不正URL、中断再開、再export |
| UI | 375px幅とPC、キーボード、空状態、ログイン切れ、保存失敗、期限切れ表示 |
| 復旧 | 別D1への復元、記事識別情報の保持、旧Queueメッセージの拒否 |

ローカル環境だけでは CPU や本番環境の制限内で動くことを確認できない。実際の Free 環境では、代表的な10〜20フィードから始め、段階的に50フィードまで増やす。7日間の保持は、時刻を固定した自動テストと8日程度の実運用で確認する。

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
