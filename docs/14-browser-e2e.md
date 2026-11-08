# 実ブラウザーE2E

## 実行方法

リポジトリの `.nvmrc` に合わせてNodeを準備し、ルートで次を実行する。

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

LinuxのCIではブラウザーのシステム依存も `npx playwright install --with-deps chromium` で導入する。
インストール済みChromeを使う場合は `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` でも実行できる。

テストは `127.0.0.1:4173` の専用Viteサーバーを起動・終了する。このポートで別のサーバーが動いていれば停止してから実行する。既存サーバーを再利用しないため、普段の開発DBや別アプリを誤って操作しない。

## データ・認証・外部通信

- `vite.e2e.config.ts` は実際のApp APIをWorkers runtimeで動かし、D1とQueueはローカルでエミュレートする。D1はメモリー内だけに保持し、通常の `.cloudflare/state` やPreview/Productionには接続しない。
- `e2e/worker.ts` だけにある `/__e2e/reset` で各テスト前に全マイグレーションを適用し、3フォルダ・1購読・55記事を準備する。テストは1ワーカーで直列に実行する。
- resetルートはこのテスト専用entrypoint以外に組み込まれず、ローカルホスト・POST・同一Originだけを受け付ける。本番Workerは `src/index.ts` のままであり、このルートを持たない。
- 認証には既存のローカルホスト用認証を使う。設定読み込みに必要なAccess変数はテスト用ダミー値を渡し、本番の認証情報は不要。Access JWTの許可・拒否・設定不足はAPIテストと実環境の検証で扱う。
- RSSの収集実行や外部サイトの閲覧は行わない。登録による初回ジョブはローカルQueueに送られ、Collectorは起動しない。

## 検証範囲と役割分担

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
OPMLの階層・部分失敗は既存のAPI・関数テストで扱う。
Preview/Productionの実認証・実収集・デプロイ確認はIssue #20の範囲。

## 待機と失敗調査

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
