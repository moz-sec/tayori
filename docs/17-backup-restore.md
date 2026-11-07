# D1 のバックアップと復元

## 方針と前提

常時利用する Mac の非公開ディレクトリに完全な SQL を毎日 03:00 に保存し、成功した新しい 7 世代を残す。
追加のクラウド保存料金を使わない構成だが、Mac の停止、スリープ、故障、ディスク容量不足、資格情報の失効には依存する。
ディスク暗号化と別媒体への暗号化コピーを推奨する。
SQL には購読先や記事などの個人情報が含まれるため、Git や公開ストレージに置かない。
保存容量とバックアップ時刻を定期的に確認する。

通常時の目標復旧時点は最大 24 時間前だが、実際の損失期間は障害発生時刻と最後に成功したバックアップの取得時刻の差であり、失敗や休止が続けば長くなる。
復旧時間はデータ量や通信状況に依存する。
Cloudflare の SQL export はスキーマとデータを含む。
export 中は DB がクエリを処理できない場合があるため、利用の少ない時間に実行する。
保存時の検査はファイルが空でないことと保存後の破損を確認するものであり、SQL の完全性や復元可能性は定期的な復元演習で確認する。
D1 の import は SQL ファイル 5 GiB までという制限がある。
詳細は [Cloudflare の import/export ドキュメント](https://developers.cloudflare.com/d1/best-practices/import-export-data/)を参照する。

## 日次取得

Node.js 24 と、対象アカウントの D1 export に必要な最小権限の API トークンを用意する。
`TAYORI_BACKUP_DIR` はリポジトリ外の専用ディレクトリとし、以下の環境変数を設定して実行する。
トークンはコマンド履歴や Git に記録しない。

```sh
node /ABSOLUTE/PATH/TO/tayori/scripts/backup-d1.mjs
```

必要な環境変数は `TAYORI_BACKUP_DIR`、`CLOUDFLARE_ACCOUNT_ID`、`TAYORI_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`。
取得中は排他ロックと一時ファイルを使用し、成功した SQL と SHA-256 ファイルを保存してから古い世代を削除する。
排他制御にはローカルファイルシステム上の `.backup-lock.sqlite` を使う。
プロセスの異常終了後もファイルは残るが、ロックは解除されるため削除しない。
トークンや署名付き URL をログや他人に渡さない。

`scripts/backup-d1.launchd.plist.example` は macOS の日次実行例である。
絶対パスを設定し、環境変数を設定して上記 Node コマンドを実行する所有者専用のラッパーを別途作成する。
plist やラッパー、ログのアクセス権を制限する。
作成した plist を `~/Library/LaunchAgents/` に置き、
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tayori.d1-backup.plist` で登録する。
スリープやログアウト中の実行を保証しないため、運用する Mac の状態を確認する。

取得失敗時は終了コードが非ゼロとなり、エラーログに記録される。
実行されなかった場合も検知できるよう、別の監視経路で毎日 `TAYORI_BACKUP_DIR` を設定して次を実行し、非ゼロ終了を通知対象にする。
26 時間以上成功していない場合、SQL が空または存在しない場合、ハッシュファイルがない場合や SHA-256 が一致しない場合は失敗する。
監視自体が停止した場合の検知は別途必要である。

```sh
node /ABSOLUTE/PATH/TO/tayori/scripts/backup-d1-check.mjs
```

## 別 DB への復元

1. アプリへの書き込み、定期収集、Queue の producer と consumer を停止する。処理中の実行が終了したことを確認し、旧 Queue メッセージが復旧先に流れないよう隔離する。tick メッセージも再投入しない。
2. 最後の成功ファイルと対応する `.sha256` を選び、保存ディレクトリ内で `shasum -a 256 -c <ファイル名>.sha256` を実行する。失敗したファイルは使わず、前の世代も確認する。
3. 復元先として空の別 D1 データベースを用意し、ID と接続先を確認する。
   元の DB に上書きしない。
   SQL を投入するには Wrangler が必要である。
   既存の `cf` CLI には export/import コマンドがないため、Wrangler を別途用意する。

   ```sh
   npx wrangler d1 execute <復元先DB> --remote --file=<バックアップSQL>
   npx wrangler d1 execute <復元先DB> --remote --file=scripts/restore-d1-safety.sql
   ```

4. 復元先の `PRAGMA integrity_check` と `PRAGMA foreign_key_check` を実行し、前者が `ok`、後者が空であることを確認する。
   `sources`、`item_keys`、`articles` の件数と代表データ、`read_at`、`starred`、`read_later` を確認し、記事が対応する item key と購読先に結び付いていることを確認する。
   バックアップ取得時点の内容と比較する。
   記事がない item key は重複防止用に残るため異常ではない。
5. 安全化 SQL は復元された未完了ジョブを失敗扱いにし、各購読先の generation を復元済みジョブの最大値より大きくする。
   停止と Queue 隔離を維持したまま結果を確認する。
   バックアップ後に作られたジョブは SQL に含まれないため、generation 更新だけに頼らず旧 Queue を隔離する。
6. 必要な migration が復元先に適用済みか確認する。
   バックアップに含まれるスキーマと現行 migration を確認して、必要なものを適用する。
   アプリの接続先を復元先に変更し、動作と収集を確認してから段階的に再開する。
   開始・終了時刻、使用した世代、障害発生時刻との差、検証結果を記録する。

## ローカル復元実演

2026-11-07 に、一時 SQLite DB に migration 0001・0002 と購読 1 件、item key 1 件、記事 1 件、未完了ジョブ 1 件を投入し、SQL dump を別の一時 DB に復元した。
安全化 SQL 適用後、`integrity_check` は `ok`、`foreign_key_check` は結果なしで、既読・スター・後で読むの各値を保持し、ジョブは `failed`、generation は 2 から 4 になった。
SQL 投入から安全化と確認までの計測は 0 秒（秒単位の計測）だった。
直前に取得した fixture のため、この実演での損失期間は 0 秒相当である。
実データ、D1 の通信時間、Queue の停止や切り替えは測定していないため、本番の復旧時間や損失期間を示すものではない。
