# API設計

実装済みAPIの一覧。ベースパス `/api/v1`、UIと同一オリジン。全APIはAccess JWT認証必須（ローカルホスト開発を除く）。時刻JSONはISO 8601 UTC。記事一覧上限50件、既読更新50記事、購読インポート5件/リクエスト。

## エンドポイント

| Method / Path                          | 入力・役割                                                          | 成功                      |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| GET /me                                | 本人確認と固定保持日数                                              | 200                       |
| GET /folders                           | 階層と並び順                                                        | 200                       |
| POST /folders                          | name, parentId                                                      | 201                       |
| PATCH /folders/:id                     | name, parentId, sortOrder                                           | 200                       |
| POST /folders/:id/move                 | direction: up / down。同じ親の隣接フォルダと表示順を交換            | 204                       |
| DELETE /folders/:id                    | 子/購読を親に移動                                                   | 204                       |
| GET /sources                           | active/paused/archived、設定のgeneration、取得状態、購読先別未読数  | 200                       |
| POST /sources                          | url, folderId, title optional                                       | 201（初回取得は非同期）   |
| PATCH /sources/:id                     | url, folderId, title, status, expectedGeneration（url指定時は必須） | 200                       |
| DELETE /sources/:id                    | アーカイブ化                                                        | 204                       |
| POST /sources/import                   | sources配列（最大5件）                                              | 200、追加/既存/エラー内訳 |
| GET /subscriptions.opml                | 購読とフォルダをXML出力                                             | 200                       |
| GET /articles                          | scope, folderId, sourceId, boardId, cursor, limit                   | 200                       |
| GET /articles/:id                      | 保存済み記事と状態                                                  | 200                       |
| PATCH /articles/:id                    | read, starred, readLater, expectedVersion                           | 200                       |
| POST /articles/read                    | articleIds（最大50）、read                                          | 200                       |
| GET /boards                            | ボード一覧                                                          | 200                       |
| POST /boards                           | name                                                                | 201                       |
| PATCH /boards/:id                      | name, sortOrder                                                     | 200                       |
| DELETE /boards/:id                     | 所属解除                                                            | 204                       |
| PUT /boards/:id/articles/:articleId    | 冪等にボード保存                                                    | 204                       |
| DELETE /boards/:id/articles/:articleId | ボード保存解除                                                      | 204                       |
| GET /status                            | 最終tick、active件数、失敗中件数                                    | 200                       |

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

## フォルダの表示順

`POST /folders/:id/move` は現在の親の中で1つ上・下へ移動する。兄弟は `sort_order, lower(name), id` の順で順位を確定し、兄弟の `sortOrder` を0からの連番へ正規化しながら対象と隣接位置を単一SQLで交換する。初期値がすべて0でも並べ替えでき、複数リクエストの部分成功は発生しない。先頭を上へ、末尾を下へ移動した場合は並びを維持する。親IDは変更しない。更新に失敗した場合は順序を確定表示せず、再操作できる。

サイドバーの折りたたみは配下の購読先と子フォルダを隠す。保存先はこのブラウザーのlocalStorageで、他端末とは共有しない。保存が使えないブラウザーでも表示中の開閉は行える。フォルダ設定の親選択肢には折りたたみにかかわらず全フォルダを表示する。

## フォルダの削除

`DELETE /folders/:id` は直下の子フォルダと購読先を親へ移してフォルダだけを削除する。最上位フォルダを削除した場合、子フォルダは最上位、購読先は未分類へ移る。孫以下の階層、記事・既読・保存状態は維持する。移動と削除はD1の1つのbatchで行い、移動先の同名フォルダと衝突した場合は `409 FOLDER_DELETE_NAME_CONFLICT` を返して変更全体を取り消す。画面では子フォルダの改名や移動を案内し、失敗した確認画面を維持する。

## 購読先の更新

`PATCH /sources/:id` は表示名、所属フォルダ、状態とRSS / Atom URLを更新する。URLは登録時と同じHTTP/HTTPS・公開先URLの検証と正規化を行い、別の購読先と正規化後のURLが重複する場合は `409 SOURCE_ALREADY_EXISTS` を返して変更しない。

購読先の一覧・登録・更新のレスポンスには設定の版 `generation` を含む。URLを含むPATCHでは、編集開始時に取得した版を `expectedGeneration` として指定する。不指定は `400 EXPECTED_SOURCE_GENERATION_REQUIRED`、版の不一致は `409 SOURCE_VERSION_CONFLICT` とし、他端末で先に保存された変更やジョブを変更しない。URL以外の更新でも `expectedGeneration` を渡せば同じ競合検出を行う。保存直前の競合も、SQLの更新条件で版を照合して検出する。

正規化後のURLが変わると、`generation` を進めて旧URLの未完了ジョブを無効にする。URL変更と旧ジョブの無効化はD1の同じbatchで行い、失敗時は両方をロールバックする。取得中の旧レスポンスも保存時の世代確認で破棄する。ETag / Last-Modified、旧URLのサイト情報・成功失敗の診断と失敗後の待機期限はリセットする。

URL保存では即時取得せず、共通の収集設定に従って次回予定を再計算する。一時停止中の購読先は変更後も停止し、再開時は次の収集境界と失敗後の待機期限を考慮する。再開だけでは待機期限を解除しない。新規登録時の初回取得は従来どおり別処理で行う。

購読先IDと既存の記事キー・記事・既読・お気に入り・あとで読むは維持する。記事キーは購読先IDとGUID・Atom ID、または記事URL等から算出する。同じキーの配信は引き続き重複排除し、内容の更新でも既読・保存状態を保つ。配信元の移行でGUIDや記事URLが変われば別キーとなり、同じ内容でも新規記事として登録される場合がある。過去キーの再計算や記事の無断統合は行わない。

## 購読先の取得状況

`GET /sources` は各購読先に `unreadCount` を返す。未読数は `read_at IS NULL` かつ、期限内、またはお気に入り・あとで読む・ボード保存で保持される記事を対象とし、記事一覧の未読フィルターと同じ条件で集計する。空の購読先は0件。全購読先の集計を1つのSQLで行い、フィード別の追加API呼び出しは行わない。

`lastCheckedAt` は成功・失敗を含む直近の確認、`lastSuccessAt` は304（更新なし）を含む最終成功。未確認・未成功はnullになる。`errorCode` と `consecutiveFailures` はCollectorが記録した失敗を示し、成功時にリセットされる。通信例外などQueueの再配信となる失敗は、必ずしもこの状態に記録されない。

`nextFetchAt` は次に収集対象となる時刻で、取得完了時刻ではない。毎時のCron、Queueの待機、予算制限等で実行は遅れ得る。停止中は値が残っていても収集対象外。`GET /status` の `lastTickAt` は全体の収集スケジューラー実行時刻で、全フィードの取得成功・完了を示さない。
