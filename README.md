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
| Web UI / API | React、Vite、Tailwind CSS、daisyUI、Hono  | 単一オリジンの画面と軽量 API     |
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

## ローカル開発

Node.js 24.22.1（`.nvmrc`、`package.json` に指定）と npm を使います。

以下のコマンドはすべてリポジトリルートで実行してください。UI の確認には、Cloudflare へのログインやリモート D1、収集 Worker の起動は不要です。

### 初回セットアップ

```sh
npm install
npm run dev:setup
npm run dev
```

`dev:setup` はローカル D1 にマイグレーションを適用し、画面を確認するための開発用データを投入します。その後、`dev` で Web UI と API の開発サーバーを起動します。ターミナルに表示された URL（通常は
`http://127.0.0.1:5173`）をブラウザーで開いてください。

開発用データには、階層フォルダ、未分類の購読先、未読・既読・お気に入り・あとで読むの記事が含まれます。購読先は収集を一時停止した状態です。

記事リンクとフィード URL には、無効なドメイン名として予約された `tayori.invalid` を使っており、リンク先のページやフィードは提供していません。記事の閲覧、既読・保存状態の変更、購読先やフォルダの管理、OPML
の入出力を確認できますが、実際のフィード取得には使えません。

開発用データを追加せずに始める場合は、`npm install` の後に次のコマンドを実行します。

```sh
npm run db:migrate:local
npm run dev
```

Git フックは [pre-commit](https://pre-commit.com/) で管理します。
初回は `npm install` に加えて、次のコマンドをリポジトリルートで実行してください。
pre-commit のインストールには uv を使います。

```sh
uv tool install pre-commit
pre-commit install
```

以降はコミット時に、整形チェック、コードの lint、Markdown の lint をリポジトリ全体に対して実行します。
未ステージの変更は pre-commit が一時退避し、ステージされた内容を検査します。
フックは自動修正しません。指摘が出た場合は `npm run lint:fix` や `npm run format` で修正し、変更を再度ステージしてください。

コミットせずに同じチェックを実行する場合は `pre-commit run`、未ステージの変更も含めて全ファイルを検査する場合は `pre-commit run --all-files` を実行します。
Git フックはクローンごとに `pre-commit install` で有効にしてください。

### 開発サーバーの起動

```sh
npm run dev
```

ローカル D1 は Cloudflare Vite plugin のローカル実行機能を使い、SQLite のデータを `apps/app/.cloudflare/state` に保存します。再起動後もデータが残るため、
毎回セットアップを実行する必要はありません。SQLite を別途インストールしたり、データベースサーバーを起動したりする必要もありません。

### スキーマの更新と開発用データの再投入

| 目的                                                   | コマンド                   |
| ------------------------------------------------------ | -------------------------- |
| 追加されたマイグレーションをローカル D1 に適用する     | `npm run db:migrate:local` |
| 開発用データを再投入する                               | `npm run db:seed:local`    |
| マイグレーションと開発用データの投入をまとめて実行する | `npm run dev:setup`        |

開発用データを再投入しても、既存データや記事の既読・保存状態は保持されます。サンプル記事の保存期限は、再投入した時点から7日後に更新します。

各 Worker の設定は `cloudflare.config.ts`、SQL マイグレーションは `migrations/` にあります。開発サーバーとビルドには Vite を、D1 マイグレーションと開発用データの投入には `cf`
CLI のローカル実行機能を使います。Cloudflare 上の D1 ID は不要です。

### Collector Worker を開発する場合

収集処理を変更する場合は、次のコマンドで collector の開発サーバーを起動できます。UI の確認だけなら、このコマンドは不要です。

```sh
npm run dev:collector
```

現状の設定では、collector のローカルデータは `apps/collector/.cloudflare/state` に保存され、app のローカル D1 とは保存先が異なります。`dev:setup` が準備するのは app
側の D1 です。

app と collector を起動するだけでは、フィードの登録から収集、画面への表示までを一通り確認できません。両 Worker の D1 と Queue を連携させるローカル開発環境は、別途整備が必要です。

収集ロジックの自動テストは、次のコマンドで実行します。

```sh
npm run test --workspace @tayori/collector
```

### 変更後の確認

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

oxfmt による整形の確認、oxlint によるコードの検査、markdownlint による Markdown の検査、型チェック、全ワークスペースのテスト、両 Worker のビルドを実行します。D1 のスキーマや運用の詳細は
[`docs/`](docs/) を参照してください。

`npm run lint:code` と `npm run lint:md` で個別に検査できます。`npm run lint:fix` は、両方の lint で自動修正できる指摘を修正します。CI でも `npm run lint`
を実行します。

`npm run format` でコード、設定ファイル、Markdown を整形できます。日本語の段落は自動で折り返さず、Markdown 内のコードブロックも整形しません。CI でも `npm run format:check`
を実行します。

## CI/CD

PRでCI・セキュリティ検査を行い、mainへのpushでプレビュー、`v0.1.0`のようなリリースタグのpushで本番へデプロイします。GitHub
ActionsとCloudflareの初回セットアップは[CI/CD設計](docs/11-ci-cd.md)を参照してください。

## Cloudflare へのデプロイ

Cloudflare 上の D1 を使う場合は、作成時に発行された ID を環境変数 `TAYORI_D1_DATABASE_ID` に設定し、両 Worker に渡します。リモート D1 にマイグレーションを適用するコマンドは
`npm run db:migrate:remote` です。ローカル開発のセットアップでは、この設定は不要です。

CloudflareのリソースとGitHub Actionsを初回設定してから、GitHub Actions経由でデプロイします。ローカルからのデプロイは通常行いません。
セットアップ手順は[CI/CD設計](docs/11-ci-cd.md)を参照してください。

```sh
cf auth login
cf d1 create --name tayori-db
cf queues create --queue-name tayori-jobs
TAYORI_D1_DATABASE_ID="YOUR_D1_DATABASE_ID" npm run db:migrate:remote
TAYORI_SECRETS_FILE=/安全な場所/app-secrets.env npm run deploy
```

`cf deploy`のdry runは各Workerのディレクトリで`npm exec cf -- deploy --prebuilt --dry-run`を実行します。
公開ホスト名とAccess適用を決めるまで本番デプロイはしないでください。mainのappはCloudflare Workers Previewsで配備し、collectorはQueue consumerとCron
Triggerを使うため専用のPreview Workerを使います。

## セキュリティとプライバシー

Tayori は個人用を想定しています。API Worker は Cloudflare Access JWT を検証し、許可メールアドレス、issuer、audience が揃わない場合はリクエストを拒否します。
これらのシークレットを設定していないローカルホストでは、開発用の認証方法を使います。フィード取得では URL、リダイレクト先、応答サイズ、取得時間を制限していますが、DNS 再束縛を完全には防げません。実際の購読先で検証するまでは、
本番利用を控えてください。

脆弱性の報告方法は [`SECURITY.md`](SECURITY.md) を参照してください。

開発手順と設計判断は [`docs/`](docs/) にあります。

## ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開します。
