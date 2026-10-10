# Tayori（たより）

読みたいサイトを自分の分類方法で整理できる、個人向けの RSS リーダーです。Feedly の無料プランで特に気になっていたフォルダ数の制限をなくし、フィード、フォルダ、ボードを自分の使い方に合わせて管理できるアプリを目指しています。

> **初期実装です。** 基本の購読・収集・閲覧フローを実装しました。Cloudflareアカウントへのリソース作成・本番設定・実購読先での負荷確認はまだ行っていません。

## 初期実装の機能

- RSS / Atom フィードの登録と定期取得
- フォルダ数に上限のない購読整理
- 記事の既読・未読、お気に入り、あとで読む
- OPML のインポートとエクスポート
- 記事データの初期保存期間は7日間
- PC とスマートフォンのブラウザで利用
- Cloudflare の無料利用枠を意識した個人運用

## 技術構成

| 領域         | 採用技術                                  | 役割                             |
| ------------ | ----------------------------------------- | -------------------------------- |
| Web UI / API | React、Vite、Tailwind CSS、daisyUI、Hono | 単一オリジンの画面と軽量 API     |
| 収集処理     | Cloudflare Workers、Cron Triggers、Queues | フィード取得を小さなジョブに分割 |
| データ       | Cloudflare D1                             | フィード、記事、既読・保存状態   |
| 認証         | Cloudflare Access                         | 本人だけが利用できる入口         |
| 開発環境     | npm workspaces、Cloudflare `cf` CLI       | モノレポ管理と Workers 開発      |

## リポジトリ構成

```text
tayori/
├── apps/
│   ├── app/                 # Vite + Hono の Web/API Worker
│   └── collector/           # 定期起動・Queue consumer
├── packages/
│   └── shared/              # アプリ間で共有する型・値
├── migrations/              # D1 SQL migrations
├── docs/                    # 要件、設計、API、運用、図
├── icon/                    # アプリアイコン
├── package.json             # npm workspaces とルートスクリプト
└── README.md
```

## 開発を始める

開発には Node.js 22.18 以降と npm が必要です。

```sh
npm install
npm run dev
```

収集 Worker のローカル開発は、次のコマンドで起動します。

```sh
npm run dev:collector
```

Cloudflare の設定は各 Worker の `cloudflare.config.ts` にまとめています。ローカル開発とビルドには Vite を、Cloudflare リソースの管理、D1 マイグレーション、デプロイには `cf` CLI を使います。Cloudflare で D1 を作成した後、発行された ID を環境変数 `TAYORI_D1_DATABASE_ID` に設定し、両 Worker に渡してください。D1 のスキーマと運用手順は [`docs/`](docs/) を参照してください。

ローカル D1 は `npm run db:migrate:local` で初期化できます。Cloudflare の D1 ID は不要です。リモートへ適用するときは、D1 ID を設定して `npm run db:migrate:remote` を実行します。

基本チェックには、次のコマンドを使います。

```sh
npm run typecheck
npm test
npm run build
```

## CI/CD

PRでテスト・ビルド・Semgrepを実行し、`v0.1.0`のようなリリースタグのpushでCloudflare本番へデプロイします。mainへのpushでは起動しません。初回のEnvironment設定、Snyk連携、D1更新と復旧の注意点は[CI/CD設計](docs/11-ci-cd.md)を参照してください。

## Cloudflare へのデプロイ

デプロイ前に Cloudflare アカウントへログインし、D1 `tayori-db` と Queue `tayori-jobs` を作成します。発行された D1 ID を環境変数 `TAYORI_D1_DATABASE_ID` に設定し、両 Worker のビルドとマイグレーションに使います。Cloudflare Access を構成し、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ALLOWED_EMAIL` を記載したシークレットファイルを用意します。

```sh
cf auth login
cf d1 create --name tayori-db
cf queues create --queue-name tayori-jobs
TAYORI_D1_DATABASE_ID="YOUR_D1_DATABASE_ID" npm run db:migrate:remote
TAYORI_SECRETS_FILE=/安全な場所/app-secrets.env npm run deploy
```

`cf deploy`のdry runは各Workerのディレクトリで`npm exec cf -- deploy --prebuilt --dry-run`を実行します。公開ホスト名とAccess適用を決めるまで本番デプロイはしないでください。収集WorkerはWorkers.devとPreview URLを無効にしています。

## セキュリティとプライバシー

Tayori は個人用を想定しています。API Worker は Cloudflare Access JWT を検証し、許可メールアドレス、issuer、audience が揃わない場合はリクエストを拒否します。これらのシークレットを設定していないローカルホストでは、開発用の認証方法を使います。フィード取得では URL、リダイレクト先、応答サイズ、取得時間を制限していますが、DNS 再束縛を完全には防げません。実際の購読先で検証するまでは、本番利用を控えてください。

脆弱性の報告方法は [`SECURITY.md`](SECURITY.md) を参照してください。

開発手順と設計判断は [`docs/`](docs/) にあります。

## ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開します。
