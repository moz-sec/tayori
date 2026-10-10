# API設計

実装済みAPIの一覧。ベースパス `/api/v1`、UIと同一オリジン。全APIはAccess JWT認証必須（ローカルホスト開発を除く）。時刻JSONはISO 8601 UTC。記事一覧上限50件、既読更新50記事、購読インポート5件/リクエスト。

## エンドポイント

| Method / Path | 入力・役割 | 成功 |
|---|---|---|
| GET /me | 本人確認と固定保持日数 | 200 |
| GET /folders | 階層と並び順 | 200 |
| POST /folders | name, parentId | 201 |
| PATCH /folders/:id | name, parentId, sortOrder | 200 |
| DELETE /folders/:id | 子/購読を親に移動 | 204 |
| GET /sources | active/paused/archivedと取得状態 | 200 |
| POST /sources | url, folderId, title optional | 201（取得は後続tick） |
| PATCH /sources/:id | folderId, title, status | 200 |
| DELETE /sources/:id | アーカイブ化 | 204 |
| POST /sources/:id/refresh | next_fetch_atを前倒し | 202 |
| POST /sources/import | sources配列（最大5件） | 200、追加/既存/エラー内訳 |
| GET /subscriptions.opml | 購読とフォルダをXML出力 | 200 |
| GET /articles | scope, folderId, sourceId, boardId, cursor, limit | 200 |
| GET /articles/:id | 保存済み記事と状態 | 200 |
| PATCH /articles/:id | read, starred, readLater, expectedVersion | 200 |
| POST /articles/read | articleIds（最大50）、read | 200 |
| GET /boards | ボード一覧 | 200 |
| POST /boards | name | 201 |
| PATCH /boards/:id | name, sortOrder | 200 |
| DELETE /boards/:id | 所属解除 | 204 |
| PUT /boards/:id/articles/:articleId | 冪等にボード保存 | 204 |
| DELETE /boards/:id/articles/:articleId | ボード保存解除 | 204 |
| GET /status | 最終tick、active件数、失敗中件数 | 200 |

`scope` には `all`、`unread`、`read-later`、`starred` を指定します。フォルダを指定すると、その子孫にある購読先の記事も対象になります。`cursor` の順序キーは検証し、SQL に直接連結しません。

## 共通契約

一覧は`{"data": [], "nextCursor": null}`、単一リソースは`{"data": {}}`形式です。

```json
{"error": {"code": "INVALID_FEED_URL"}}
```

- API は JWT 検証に失敗した場合に401を返し、本人以外からのアクセスには403を返す。Access によるログイン画面へのリダイレクトは API の JSON 応答とは分けて扱い、UI から再ログインを案内する。
- 入力不正400、存在しない/削除済み404、重複URLや更新version競合409、サイズ超過413、認証設定不足503。
- PATCHは値を指定する。toggle命令を使わず、再送時に反転させない。
- 単一記事のversion競合は再読込して再操作。まとめて既読は冪等の値設定とし、欠けたIDと更新件数を返す。
- 購読URL正規化と一意制約により移行の再送を許容する。フォルダの重複登録は409を返す。
- POST /refreshは同期取得しません。次の5分tickで候補になるよう次回時刻を前倒しします。
- 名前は100文字、URL は2048文字など、入力値をサーバー側で検証する。すべての SQL で bind パラメータを使う。
- Origin、CSRF、Content-Typeを検証し、CORSで他オリジンを許可しない。GETに更新副作用を持たせない。
- APIはCache-Control: private, no-store。ログにCookie・JWT・記事本文・秘密付きURLを残さない。

大容量SQLバックアップや復元をHTTP APIに実装しない。運用CLIから実施する。
