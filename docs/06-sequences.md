# シーケンス図

編集元は[diagrams](diagrams/README.md)。実装の成功経路だけでなく、重複配信と保存失敗も検証する。

## 1. ログイン・記事表示

```mermaid
sequenceDiagram
    actor U as 本人
    participant B as ブラウザ
    participant A as Access
    participant W as Web Worker
    participant D as D1
    U->>B: Tayoriを開く
    B->>A: 保護URLへアクセス
    alt セッションなし
        A-->>U: メールPINで本人認証
        U->>A: PIN入力
    end
    A->>W: 認証情報付きリクエスト
    W->>W: 署名・issuer・aud・期限・本人確認
    alt 無効 / 設定不足
        W-->>B: アクセス拒否
    else 有効
        W-->>B: UI配信
        B->>A: 記事一覧API
        A->>W: 認証情報付きAPI
        W->>W: 再検証
        W->>D: 期限と保存条件で一覧取得
        D-->>W: 記事とcursor
        W-->>B: private, no-store JSON
    end
```

初期UIは再読込・フォーカス復帰で状態を同期。レスポンスが古い場合の書戻しはversionで防止する。

## 2. 定期収集

```mermaid
sequenceDiagram
    participant C as Cron
    participant Q as Queue
    participant W as Collector
    participant D as D1
    participant E as RSS配信元
    C->>Q: 5分ごとtick
    Q->>W: tick配信
    W->>D: 期限・予算確認 / job作成 / 予約
    D-->>W: 送信待ちjob
    W->>Q: fetch(jobId, sourceId, generation)
    W->>D: 送信済み記録
    W->>Q: tick ack
    Q->>W: fetch配信
    W->>D: 条件付きclaimとlease取得
    alt 完了済み / 古い世代
        W->>Q: ackして終了
    else 実行権あり
        W->>E: If-None-Match / If-Modified-Since
        alt 304
            E-->>W: Not Modified
            W->>D: 状態・次回予定・job完了
            W->>Q: ack
        else 200
            E-->>W: RSS / Atom
            W->>W: 制限確認・解析・キー生成
            W->>D: 冪等な記事保存（世代条件付き）
            D-->>W: 保存完了
            W->>D: validators・成功時刻・job完了
            W->>Q: ack
        else 429 / 5xx / 解析失敗
            W->>D: エラーと次回予定を保存
            W->>Q: ack（次回はCronから）
        end
    end
    Note over W,D: DB障害等は限定再試行。完了前にvalidatorsを進めない
    Note over Q,D: 未完了は台帳から回収。重複送信はjobIdで無害化
```

tickが遅延/重複してもD1の期限・ジョブ状態が正本。順序保証に依存しない。lease切れは新generationで回収し、古いworkerは書き込めない。

## 3. OPML移行

```mermaid
sequenceDiagram
    actor U as 本人
    participant B as ブラウザ
    participant W as 認証済みAPI
    participant D as D1
    participant C as Collector
    U->>B: FeedlyのOPMLを選択
    B->>B: サイズ検証・XML解析・階層表示
    B-->>U: 追加候補 / 重複 / 不正を表示
    U->>B: インポート実行
    loop 親フォルダから作成
        B->>W: フォルダ作成
        W->>D: 既存確認・登録
        W-->>B: folderId
    end
    loop 購読先を最大5件ずつ
        B->>W: 正規化候補を送信
        W->>W: 入力再検証
        W->>D: 一意制約で購読登録
        W-->>B: 追加 / 既存 / エラー
    end
    B-->>U: 結果と未取得状態
    C->>D: 次のtickで取得対象を選ぶ
    Note over B,D: 中断後の再実行でも二重登録しない
```

ブラウザによる解析は操作のための前処理。サーバー側でURL・サイズ・フォルダ所属・重複を再検証する。RSSネットワーク取得をインポートAPI内で待たない。

## 4. 保存期限・記事再出現防止

```mermaid
sequenceDiagram
    participant T as 時間経過
    participant W as Collector tick
    participant D as D1
    participant F as 次回RSS取得
    T->>W: 1時間ごとの整理タイミング
    W->>D: expires_at経過記事を小分け選定
    alt 保存指定あり
        W->>D: 保持
    else 保存指定なし
        W->>D: 現在の保存条件を再確認して記事削除
        Note over D: item_keysは残す
    end
    F->>D: 同じ記事キーを照会
    D-->>F: キーあり・記事なし
    F->>F: 期限削除済みとして再作成しない
```

保存操作と削除の競合はSQLの現在状態で決定。item_keysはバックアップ対象であり、復元時に失うと古い記事が再登録され得る。
