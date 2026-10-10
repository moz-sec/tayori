# @tayori/app

Vite で React の画面を開発・ビルドします。Cloudflare Vite plugin と `cf` CLI を使い、Hono API と静的アセットを Workers で動かします。API は `/api` 配下です。

リポジトリルートで `npm run dev` を実行してください。画面では記事の閲覧、購読先やフォルダの管理、OPML の入出力を行えます。

Worker の設定は `cloudflare.config.ts` にまとめています。ローカル D1 は、リポジトリルートで `npm run db:migrate:local` を実行して初期化します。リモート D1 への適用には Cloudflare D1 の ID が必要です。次のように実行してください。

```sh
TAYORI_D1_DATABASE_ID="YOUR_D1_DATABASE_ID" npm run db:migrate:remote
```
