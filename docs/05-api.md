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
| GET /sources | active/paused/archived、取得状態、購読先別未読数 | 200 |
| POST /sources | url, folderId, title optional | 201（初回取得は非同期） |
| PATCH /sources/:id | folderId, title, status | 200 |
| DELETE /sources/:id | アーカイブ化 | 204 |
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
- 新規購読の登録・インポート時は、初回RSS取得ジョブをQueueへ送信する。RSS取得と記事保存は非同期で行い、送信に失敗した場合は毎時のCollector tickで回収する。
- 画面のRefreshとページ表示はD1に保存済みの記事を再取得するだけとし、RSS取得ジョブは作成しない。
- 名前は100文字、URL は2048文字など、入力値をサーバー側で検証する。すべての SQL で bind パラメータを使う。
- Origin、CSRF、Content-Typeを検証し、CORSで他オリジンを許可しない。GETに更新副作用を持たせない。
- APIはCache-Control: private, no-store。ログにCookie・JWT・記事本文・秘密付きURLを残さない。

大容量SQLバックアップや復元をHTTP APIに実装しない。運用CLIから実施する。

## 購読先の取得状況

`GET /sources` は各購読先に `unreadCount` を返す。未読数は `read_at IS NULL` かつ、期限内、またはお気に入り・あとで読む・ボード保存で保持される記事を対象とし、記事一覧の未読フィルターと同じ条件で集計する。空の購読先は0件。全購読先の集計を1つのSQLで行い、フィード別の追加API呼び出しは行わない。

`lastCheckedAt` は成功・失敗を含む直近の確認、`lastSuccessAt` は304（更新なし）を含む最終成功。未確認・未成功はnullになる。`errorCode` と `consecutiveFailures` はCollectorが記録した失敗を示し、成功時にリセットされる。通信例外などQueueの再配信となる失敗は、必ずしもこの状態に記録されない。

`nextFetchAt` は次に収集対象となる時刻で、取得完了時刻ではない。毎時のCron、Queueの待機、予算制限等で実行は遅れ得る。停止中は値が残っていても収集対象外。`GET /status` の `lastTickAt` は全体の収集スケジューラー実行時刻で、全フィードの取得成功・完了を示さない。
