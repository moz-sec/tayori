# データ設計

## 1. ER図

```mermaid
erDiagram
    FOLDERS o|--o{ FOLDERS : parent
    FOLDERS o|--o{ SOURCES : contains
    SOURCES ||--o{ ITEM_KEYS : identifies
    ITEM_KEYS ||--o| ARTICLES : payload
    ARTICLES ||--o{ BOARD_ARTICLES : saved
    BOARDS ||--o{ BOARD_ARTICLES : contains
    SOURCES ||--o{ FETCH_JOBS : collects
    FOLDERS {
        string id PK
        string parent_id FK
        string name
    }
    SOURCES {
        string id PK
        string folder_id FK
        string normalized_url UK
        string status
        int next_fetch_at
        int generation
    }
    ITEM_KEYS {
        string id PK
        string source_id FK
        string key_hash
        int first_seen_at
    }
    ARTICLES {
        string id PK, FK
        string title
        int expires_at
        int read_at
        boolean starred
        boolean read_later
        int version
    }
    BOARDS {
        string id PK
        string name UK
    }
    BOARD_ARTICLES {
        string board_id PK, FK
        string article_id PK, FK
    }
    FETCH_JOBS {
        string id PK
        string source_id FK
        string status
        int generation
        int lease_until
    }
    DAILY_USAGE {
        string day_utc PK
        int reserved_queue_ops
        int new_articles
    }
    APP_STATE {
        string key PK
        string value
    }
```

## 2. 論理テーブル

IDはUUID等の不透明文字列、日時はUTCのUnix時刻（秒）に統一する。個人用のためユーザーテーブルは初期に設けない。

| テーブル | 主な列・制約 |
|---|---|
| folders | id, parent_id nullable, name, sort_order。循環禁止。親ごとの名前一意（ルートも正規化して制約） |
| sources | id, kind=rss, normalized_url UNIQUE, title, folder_id, status(active/paused/archived), interval_minutes, next_fetch_at, last_checked_at, last_success_at, etag, last_modified, error_code, error_count, generation |
| item_keys | id, source_id, key_hash, first_seen_at。UNIQUE(source_id,key_hash)。本文削除後も残す |
| articles | id=item_keys.id, title, url, summary_text, published_at nullable, content_hash, read_at nullable, starred, read_later, first_seen_at, expires_at, updated_at, version |
| boards | id, name UNIQUE, sort_order |
| board_articles | board_id, article_id, created_at。複合主キー |
| fetch_jobs | id, source_id, generation, status(pending/sent/running/done/failed), lease_until, attempts, created_at, completed_at。稼働中ジョブは購読先ごとに1件 |
| daily_usage | day_utc PK, reserved_queue_ops, new_articles, observed_rows_read, observed_rows_written。上限付き原子的加算 |
| app_state | key PK, value。収集停止、整理カーソル、最終tick等の少数の状態 |

初期スキーマとして [`migrations/0001_initial.sql`](../migrations/0001_initial.sql) を用意した。API の実装に合わせて制約や列を見直し、テストデータを使ってマイグレーションを検証する。

## 3. 記事キー

優先順はAtom id / RSS guid → 解決済み記事URL → タイトルと配信日時等の安定項目。キー種別を付けてSHA-256化する。GUIDはURLとして扱わず不透明文字列のまま使う。

URLはフラグメント除去、host正規化等の安全な範囲だけを正規化し、意味のあるqueryを無差別に削除しない。購読先間では重複排除しない。IDやURLが変わる配信元では完全一致の保証はできず、フィクスチャで限界を記録する。

- 新規キー: item_keysとarticlesを同じ原子的単位で作成する。キーだけ先に確定しない。
- 既存キー＋記事あり: 内容変更時のみ更新し、既読・保存状態・初回取得日時・期限を維持。
- 既存キー＋記事なし: 期限削除済みなので再作成しない。

`item_keys` は購読解除後も保持する。件数の増加を監視し、自動で期限切れ記事を削除しても同じ記事が再登録されないようにする。将来「履歴を完全に消去」する機能を設ける場合は、記事が再取り込みされる可能性を明示する操作として別途設計する。

## 4. 保持と同時更新

expires_at=first_seen_at+604800。read_atは保持に影響しない。

削除条件は `expires_at <= now AND starred=0 AND read_later=0 AND ボード所属なし`。一覧でも同じ条件で期限切れの記事を除外する。記事は200行程度ずつ削除し、`item_keys` は残す。ボードに保存されているかどうかは削除 SQL 内で再確認し、事前に取得した古い状態だけを根拠に削除しない。

保存APIと整理が競合した場合、保存が先なら保持、削除が先なら404を返す。成功していない保存をUIで確定表示しない。公開日時が欠ける記事は一覧の表示順にfirst_seen_atを使う。

## 5. インデックス案

- sources(status,next_fetch_at)、sources(folder_id)
- articles(first_seen_at DESC,id DESC)
- articles(read_at,first_seen_at DESC,id DESC)
- articles(expires_at)、item_keys(source_id,key_hash) UNIQUE
- board_articles(article_id) と複合主キー(board_id,article_id)
- fetch_jobs(status,lease_until)、fetch_jobs(source_id,generation)

一覧はcursor pagination。OFFSETで全履歴を走査しない。フォルダ階層の検索は循環を排除した再帰CTEを候補とし、実測で読取行数を確認する。保存フラグの追加インデックスは必要になるまで増やさない。

## 6. 削除と復元

folders削除は所属を親へ移動。boards削除はboard_articlesを削除。sourcesはアーカイブ化して保存記事・識別情報を保持。articlesの物理削除ではboard_articlesをCASCADEにできるが、通常の期限整理は所属ありを対象にしない。

SQL バックアップにはすべてのテーブルを含める。復元後は古い `running` / `sent` 状態のジョブを無効にし、`generation` を更新して Queue 内の古いメッセージを拒否する。
