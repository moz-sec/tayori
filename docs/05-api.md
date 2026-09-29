# API設計

設計案。ベースパス `/api/v1`、UIと同一オリジン。全APIは認証必須、時刻JSONはISO 8601 UTC。初期の一覧上限50件、更新バッチ50記事、購読インポート5件/リクエスト。

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
| POST /sources/:id/refresh | next_fetch_atを前倒し。連打抑止 | 202 |
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
| GET /status | 最終tick、収集停止理由、取得失敗数 | 200 |

`scope`はall/unread/read-later/starred。フォルダ指定は子孫を含める。競合する絞り込みは400。cursorは順序キーとフィルタ条件を検証し、SQLへ直接連結しない。

## 共通契約

```json
{"data": [], "nextCursor": null}
```

```json
{"error": {"code": "FETCH_BUDGET_EXHAUSTED", "message": "本日の取得を停止しています", "retryable": true}, "requestId": "opaque-id"}
```

- APIはJWT検証に失敗したら401、本人以外は403。AccessによるログインへのリダイレクトはAPI JSONとは別に扱い、UIで再ログインを案内する。
- 入力不正400、存在しない/削除済み404、重複URLや更新version競合409、サイズ超過413、頻度制限429、予算/基盤停止503。
- PATCHは値を指定する。toggle命令を使わず、再送時に反転させない。
- 単一記事のversion競合は再読込して再操作。まとめて既読は冪等の値設定とし、欠けたIDと更新件数を返す。
- 購読URL正規化と一意制約により移行の再送を許容する。フォルダ作成も同じ親・名前を検出して既存IDを返せるようにする。
- POST /refreshは同期取得しない。最短15分/購読先を設計案とし、無料枠予算に合算する。
- 名前100文字、URL2048文字等をサーバー側で検証。全SQLはbindパラメータを利用。
- Origin、CSRF、Content-Typeを検証し、CORSで他オリジンを許可しない。GETに更新副作用を持たせない。
- APIはCache-Control: private, no-store。ログにCookie・JWT・記事本文・秘密付きURLを残さない。

大容量SQLバックアップや復元をHTTP APIに実装しない。運用CLIから実施する。
