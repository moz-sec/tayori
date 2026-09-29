# Tayori（たより）

自分が読みたいサイトを、好きなだけ整理して追いかけるための、個人向け RSS リーダーです。Feedly の無料プランで特に気になっていたフォルダ数の制限をなくし、フィード、フォルダ、ボードを自分の使い方に合わせて管理できることを目指しています。

> **開発初期です。** 画面や機能はまだ実装途中で、安定運用やデータ移行を保証するリリースではありません。

## 目指す機能

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
| Web UI / API | Vite、Hono、TypeScript                    | 単一オリジンの画面と軽量 API     |
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

必要なものは Node.js 22.18 以降と npm です。Cloudflare CLI は各アプリの開発依存関係としてインストールし、Cloudflare アカウントへデプロイする場合にログインします。

```sh
npm install
npm run dev
```

収集 Worker のローカル開発:

```sh
npm run dev:collector
```

スクリプトや Cloudflare リソース設定が未整備の箇所があります。実装が進むまでは、利用できないスクリプトがあることに注意してください。D1 のスキーマと運用手順は [`docs/`](docs/) を参照してください。

## Cloudflare へのデプロイ

デプロイ前に D1 と `tayori-jobs` Queue を作成し、`cloudflare.config.ts` と D1 マイグレーション用 `wrangler.jsonc` のサンプル database ID を実際の ID に置き換え、Cloudflare Access を設定する必要があります。現時点でこのリポジトリに本番リソースや認証情報は含めていません。Cloudflare の課金を避けるには、ダッシュボードでプランと使用量を確認し、無料枠内で運用してください。無料枠や機能の提供条件は変更される場合があります。収集 Worker はまだ未実装のため、本番へデプロイしないでください。

## セキュリティとプライバシー

Tayori は個人用を想定しています。公開環境では Cloudflare Access で入口を保護し、Worker 側でも認証を確認する設計です。フィード取得機能は任意 URL を取得するため、公開 URL の検証、リダイレクト制限、応答サイズ制限などを実装してから利用可能にします。実装前の段階で機密情報や本番購読データを登録しないでください。

脆弱性の報告方法は [`SECURITY.md`](SECURITY.md) を参照してください。

## 開発への参加

開発手順と設計判断は [`docs/`](docs/) と [`CONTRIBUTING.md`](CONTRIBUTING.md) にあります。Issue や Pull Request は歓迎します。大きな仕様変更は、先に Issue で目的と影響を相談してください。

## ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開します。
