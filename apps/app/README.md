# @tayori/app

Vite で React の画面を開発・ビルドします。Cloudflare Vite plugin と `cf` CLI を使い、Hono API と静的アセットを Workers で動かします。API は `/api` 配下です。

Worker の設定は `cloudflare.config.ts` にまとめています。
ローカル開発、サンプルデータの投入、D1 マイグレーションの手順は、リポジトリルートの [README](../../README.md#ローカル開発) を参照してください。
