# @tayori/app

Vite が静的画面を開発・ビルドし、Cloudflare Vite plugin と `cf` CLI が Workers 上で Hono API と配信アセットを扱います。API は `/api` 配下です。

リポジトリルートで `npm run dev` を実行してください。現在は開発中の画面と `/api/health` のみです。

`wrangler.jsonc` は D1 マイグレーション用です。実際の Cloudflare D1 を作成した後、app と collector の `cloudflare.config.ts` および `wrangler.jsonc` のサンプル database ID を作成した ID に置き換えてください。
