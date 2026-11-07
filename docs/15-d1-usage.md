# D1利用量の監視

監視を有効にすると、定期実行時にCloudflare GraphQL Analytics APIからアカウント全体の当日UTCの読み取り行数と書き込み行数を取得する。
対象データベースの容量はD1 REST APIの `file_size` から取得する。監視結果と設定はD1の `app_state` に保存する。
取得値にはCloudflare側の集計遅延があり、上限への到達を事前に完全には防げない。

ビルド時に `TAYORI_D1_USAGE_ENABLED=true` を指定し、Collectorに `D1_USAGE_ENABLED=true`、`D1_ACCOUNT_ID`、`D1_DATABASE_ID`、`D1_STORAGE_LIMIT_BYTES`、`D1_ROWS_READ_LIMIT`、
`D1_ROWS_WRITTEN_LIMIT`、`D1_WARNING_RATIO`、`D1_MAX_AGE_SECONDS` を設定する。
`D1_ANALYTICS_TOKEN` はGraphQL Analyticsの読み取りと対象D1情報の読み取りに必要な権限を持つシークレットとしてCollectorに設定する。
数値の上限と最大経過秒数は正数、警告割合は0より大きく1より小さい数とする。未設定では監視は無効となる。

無料枠はアカウント内の他のデータベースとも共有される。行数はアカウント全体を監視するが、容量は対象データベースのみを監視するため、他のデータベースが使う容量と集計遅延、監視自体の操作に十分な余裕を残して上限を決める。監視1回につき外部APIを2回呼び出し、設定と観測値の保存などにD1の読み書きを使う。通常の定期実行ごとに取得するため、実際の消費量は実行頻度に依存する。

取得失敗後は最後の観測値を保持し、設定した最大経過時間を過ぎると新しい取り込みを停止する。UTCの日付が変わった場合も、当日の観測値を取得するまで停止する。設定上限に達した場合は、上限を下回る新しい観測値が得られると再開する。監視の停止を解除するには、設定と接続権限を確認し、取得が成功することを確認する。保存済み記事は監視によって削除しない。

参照: [D1のメトリクスと分析](https://developers.cloudflare.com/d1/observability/metrics-analytics/)、[D1 API](https://developers.cloudflare.com/api/resources/d1/)。
