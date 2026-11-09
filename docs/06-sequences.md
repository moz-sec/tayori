# シーケンス図

実装では、成功する場合に加えて、重複配信や保存失敗も検証する。

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
        W-->>B: APIへのアクセスを許可
        B->>A: 記事一覧API
        A->>W: 認証情報付きAPI
        W->>W: 再検証
        W->>D: 期限と保存条件で一覧取得
        D-->>W: 記事とcursor
        W-->>B: private, no-store JSON
    end
```

静的アセットはWorkerを経由せず配信されるため、図のAccessによるUI保護は実環境での確認が必要である。

初期 UI は、再読み込み時と画面に戻ったときに状態を同期する。古いレスポンスによる上書きは `version` で防ぐ。

## 2. 定期収集

```mermaid
sequenceDiagram
    participant C as Cron
    participant Q as Queue
    participant W as Collector
    participant D as D1
    participant E as RSS配信元
    C->>Q: 毎時tick
    Q->>W: tick配信
    W->>D: 期限と予算を確認 / jobを作成・予約
    D-->>W: 送信待ちjob
    W->>Q: fetch(jobId)
    W->>D: 送信済み記録
    W->>Q: tick ack
    Q->>W: fetch配信
    W->>D: 条件付きでclaimしleaseを取得
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
            W->>W: 制限の確認・解析・キー生成
            W->>D: 世代を確認して記事を冪等に保存
            D-->>W: 保存完了
            W->>D: validators・成功時刻・job完了
            W->>Q: ack
        else 429 / 5xx / 解析失敗
            W->>D: エラーと次回予定を保存
            W->>Q: ack（次回はCronから）
        end
    end
    Note over W,D: DB障害等は限定再試行。完了前にvalidatorsを進めない
    Note over Q,D: 未完了jobはD1の記録から回収。重複送信はjobIdで判別
```

tick が遅延または重複しても、期限とジョブの状態は D1 の値を基準に処理するため、メッセージの順序保証には依存しない。lease が切れたジョブは新しい generation で回収し、古い Worker からの書き込みを拒否する。

### 収集スケジュールの適用

CollectorのCronは毎時00分に起動する。間隔モードはUTC epochを基準に、指定時間数の倍数となる次の時間境界に合わせる。例えば6時間間隔ならJST 03:00・09:00・15:00・21:00となる。
保存直後の最初の待ち時間は指定間隔より短い場合がある。日次モードは保存時刻より後の最初のJST指定時刻を選ぶ。

Collectorは処理完了時刻ではなく時間境界から次の予定を計算するため、Queue待ちによる遅延が次の間隔を延ばさない。予定は取得開始の目安であり、Queue待ちやRSS応答によって取得完了は遅れる。

設定変更時、pending・sent・runningのジョブは取り消さず、一度完遂してから新しい予定へ移る。設定保存では追加ジョブを作らない。処理中に設定が変更された場合、完了したジョブは保存し直された次回予定を上書きしない。
Collectorはジョブ作成時にも設定スナップショットをSQLで照合する。

失敗時は段階的な待機とRetry-Afterを守り、定期収集の予定と失敗後の待機期限の遅い方を次回取得とする。待機期限は `sources.retry_not_before` に保存し、設定変更でも短縮しない。
日次設定でも通常は次の日次予定まで待ち、待機期限がその予定を越える場合は期限後の毎時Cronで再試行する。

古い時間帯の遅延tickは破棄し、現在の時間帯のtickで期限超過の購読先を1回だけ取得する。過去の予定の回数分は再実行しない。有効ジョブの一意制約、generation検証、Queue予算予約、
記事キーとcontent_hashによって重複を防ぐ。

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

ブラウザでの解析は、インポート操作の前処理として行う。サーバー側でも URL、サイズ、フォルダの所属、重複を検証する。インポート API の処理中に RSS の取得完了を待たない。

## 4. 保存期限・記事再出現防止

```mermaid
sequenceDiagram
    participant T as 時間経過
    participant W as Collector tick
    participant D as D1
    participant F as 次回RSS取得
    T->>W: 毎時のtick
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

保存操作と削除が競合した場合は、SQL 実行時点の状態で結果を決める。`item_keys` はバックアップ対象であり、復元時に失うと古い記事が再登録される可能性がある。
