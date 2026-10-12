# CI/CD設計

## 今回の範囲

プルリクエストでは CI を実行し、`main` への push では最新コミットをCloudflareプレビュー環境へ配備する。`vX.Y.Z`（例: `v0.1.0`）タグを push すると本番環境へリリースする。どちらもGitHub Actionsから実行し、日常のローカルデプロイは行わない。

`main` のappはCloudflare Workers Previewsとして `tayori-app` の下に配備し、Preview URLと本番Workerを分ける。D1は `tayori-preview-db` を使い、本番データを共有しない。collectorはQueue consumerとCron Triggerを使うためCloudflare Previewsでは実行できず、専用Worker `tayori-collector-preview` を使う。Preview collectorは `tayori-preview-db` と `tayori-preview-jobs` に接続する。Preview appのAccess認証値はCloudflareのPreviews Base secretsに登録する。mainの連続pushは同じconcurrencyグループで直列化し、古い実行をキャンセルして最新の状態を反映する。

## タグリリースの設計

Release ワークフローはタグ名を検証し、対象コミットが `origin/main` の履歴に含まれることを確認する。続いて Security ワークフローを再利用し、依存関係の監査と Semgrep を実行する。両方の検査に成功した場合だけ、production Environment で型チェック、テスト、ビルドを実行する。その後、D1 migration、app、collector の順に更新する。ビルド成果物は同じジョブ内で `cf deploy --prebuilt` に渡し、再ビルドしない。

本番更新は共通concurrencyグループで直列化し、進行中のデプロイを新しいタグでキャンセルしない。待機中の実行は新しい実行で置換される場合があるため、タグは前のリリース結果を確認してから打つ。タグの付け直しは禁止し、失敗時は影響を確認して同じ実行を再実行するか修正タグを作る。

D1 の変更は、旧 Worker と互換性のある追加変更に限る。既存の migration は編集せず、新しい SQL ファイルを追加する。migration または Worker の更新中に失敗すると、それまでに成功した更新は残る。複数の Worker と D1 の更新は原子的ではなく、自動ロールバックもしない。古い Worker に戻す場合も、DB との互換性を確認してから行う。

## セキュリティ検査の役割分担

依存パッケージの継続監視には Snyk Open Source の GitHub 連携を使い、ソースコードの静的解析には GitHub Actions の Semgrep CE を使う。Snyk CLI は Actions に追加せず、`SNYK_TOKEN` も登録しない。今回の構成では Snyk Code を有効にしない。

| 担当 | 対象・運用 |
|---|---|
| Snyk Open Source | npm workspacesの本番・開発依存、PRチェック、日次の継続監視、修正版がある場合の修正PR |
| Semgrep CE | apps / packagesのソースコードをPR・リリースタグ・週次で解析 |
| Dependabot | GitHub Actionsのバージョン更新PRのみ |
| npm audit | Snykの導入確認が完了するまで依存関係検査を継続 |

Snykの連携設定はSnyk側で管理する。`.snyk`ファイルは連携を有効化するものではないため、理由のある例外設定が必要になるまで追加しない。自動修正PRのマージは手動とし、通常のCIを通す。

## Snyk接続手順と移行条件

1. Snykにログインし、使用するOrganizationでGitHub連携を設定する。リポジトリを選択できる方式では `moz-sec/tayori` のみにアクセスを限定する。表示される権限・契約条件は接続時に確認する。
2. `moz-sec/tayori` のmainをインポートする。ルートのpackage.json / package-lock.jsonに加え、apps/app、apps/collector、packages/sharedのworkspace依存が検査対象に含まれることを結果で確認する。開発依存も検査対象に含める。
3. Open SourceのPRチェックを有効化し、high/criticalを失敗基準とする。既存の脆弱性も確認対象とし、新規脆弱性だけの判定との違いに注意する。Snyk CodeのCode Analysisチェックは有効化しない。
4. 定期検査を日次に設定し、脆弱性通知と自動修正PRを有効化する。通常の依存アップグレードPRは当初無効とする。利用プランの実行枠を確認する。
5. 初回スキャン結果で依存の検出範囲を確認し、PR上にSnykのチェックが出ることを確認する。既存のundiciの指摘についても検出・評価を確認する。
6. GitHub上で実際に表示されたSnykチェック名と発行元を確認し、利用可能であればmainの必須チェックに追加する。検出がないため成功した状態と、未実行・対象なしを区別する。
7. ここまで完了した後、別変更でSecurityのDependency auditジョブとその必須チェック指定を削除する。連携前に削除しない。

接続状況: Snyk にはログインしていない。GitHub の `main` にある check runs とリポジトリの Webhook からは、Snyk が連携済みだと確認できる情報を得られていない。ただし、この情報だけでは未接続と断定できないため、Snyk 側の設定と初回 PR の結果で確認する。

## 実行条件と合格基準

| ワークフロー / ジョブ | 条件 | 合格基準 |
|---|---|---|
| CI / Test and build | main向けPR、手動 | npm ci、型チェック、既存テスト、両Workerのビルドが成功 |
| Preview | mainへのpush | 型チェック、テスト、collectorのビルド後、プレビューD1 migration、app Previewと専用collector Workerの配備が成功 |
| Security / Dependency audit（移行中） | 同上、リリースからの呼び出し、および毎週月曜09:23 JST | 開発依存を含むnpm auditでhigh/criticalがない |
| Security / Semgrep | 同上、リリースからの呼び出し、および毎週月曜09:23 JST | p/defaultの静的解析で検出がなく、解析エラーもない |
| Release | vX.Y.Zタグのpush | main所属確認、Security、型チェック、テスト、ビルド成功後に本番へ反映 |

Node.js 24、Ubuntu 24.04を使用する。インストールはルートのpackage-lock.jsonを使う。セキュリティ検査はテストの成否に依存せず実行する。週次検査は変更がなくても新たな脆弱性情報・ルールを取り込むために行う。スケジュールはデフォルトブランチ上で実行され、開始時刻は遅延する場合がある。

## 権限と依存ツール

- GITHUB_TOKENはcontents: readのみ。checkout後に認証情報を残さない。
- pull_requestを使用し、pull_request_targetでPRのコードを実行しない。PRのCIにSecretsは不要。本番のSecretsはproduction Environmentにのみ登録する。
- SnykにはGitHub連携を通じてリポジトリへのアクセスを付与する。Actionsの権限とは別にSnyk側の連携権限を管理する。
- Actionsは完全なコミットSHAで固定し、Dependabotで週次の更新PRを作成する。
- Semgrep CEはバージョンを固定。Registryのp/defaultルールは最新を取得するため、判定は更新される。metricsとバージョン確認を無効化し、ソースや結果をSemgrepプラットフォームへアップロードする設定は使わない。
- npm auditは依存情報をnpm Registryへ送信する。取得障害や解析エラーもジョブ失敗として扱い、黙って検査を省略しない。
- 設定中のnpm Registry mirrorはRolldownのLinux向けoptional dependencyをlockfileに収録しないため、Linux runnerでは`npm ci`後に`@rolldown/binding-linux-x64-gnu`をlockfile非更新で追加する。Node 24 / x64 / glibc runnerを前提とする。mirrorが修正されたら暫定手順を削除できる。
- 非公開リポジトリで追加ライセンスを前提にしないため、今回CodeQLは採用しない。
- 同一PR・同一ブランチの古い実行をキャンセルし、各ジョブに時間制限を設ける。

## 運用と限界

GitHub に反映した後、Actions の初回実行を確認する。マージを制限する場合は、リポジトリの Rulesets または Branch protection で `Test and build`、`Dependency audit`、`Semgrep` を必須チェックに設定する。ワークフローを追加しただけでは、チェックに失敗してもマージは止まらない。利用できる保護機能と Actions の実行枠は契約によって異なる。

プレビュー用の初回準備として、別D1 `tayori-preview-db` とQueue `tayori-preview-jobs` を作成し、プレビューD1 IDをGitHub Environment `preview` の `TAYORI_PREVIEW_D1_DATABASE_ID` に登録する。`CLOUDFLARE_ACCOUNT_ID` とプレビュー専用の `CLOUDFLARE_API_TOKEN` も `preview` Environment に登録する。トークンには対象アカウント内のWorkers Previews配備、Workersスクリプト配備、D1 migration、Queue設定に必要な権限を付与する。プレビューと本番の認証情報は分ける。プレビューQueueが収集処理を起動することを理解した上で、必要ならcollectorのスケジュールやフィード取得先をプレビュー向けに制限する。

## 初回セットアップ手順

### 1. Cloudflareリソースを作成

Cloudflareアカウントで `cf auth login` を済ませ、ルートでプレビューと本番それぞれのD1、Queueを作成する。表示されたD1 UUIDを控える。

```sh
cf auth login
cf d1 create --name tayori-preview-db
cf queues create --queue-name tayori-preview-jobs
cf d1 create --name tayori-db
cf queues create --queue-name tayori-jobs
```

Queue名はcollector設定で参照する。Workersデプロイ時にbinding/consumerが自動設定されるが、Queue自体は先に作成しておく。

### 2. Cloudflare API Tokenを用意

Cloudflare DashboardでGitHub Actions用API Tokenを作る。対象アカウントを限定し、Workersのスクリプト配備、D1データベースとmigrationへのアクセス、Queuesの読み書き・設定に必要な権限を付ける。プレビュー用と本番用に別Tokenを作る。Token値はGitHub Secretsにのみ保存する。

### 3. GitHub Environmentsを作成

GitHubリポジトリの **Settings → Environments** で `preview` と `production` を作成する。Environmentはworkflowごとではなく、配備先ごとに分ける。`production`のDeployment branchesを`v*`タグに限定する。

`preview` Environmentには次を登録する。

| 種別 | 名前 | 値 |
|---|---|---|
| Variable | `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| Variable | `TAYORI_PREVIEW_D1_DATABASE_ID` | `tayori-preview-db`作成時に表示されたUUID |
| Secret | `CLOUDFLARE_API_TOKEN` | プレビュー用API Token |

Cloudflare Dashboardで `tayori-app` の **Settings → Previews Base** を有効にし、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ALLOWED_EMAIL` をPreviews BaseのSecretsとして登録する。ProductionのSecretsはPreviewに自動継承されない。Preview用の `DB` bindingは`cloudflare.config.ts`がPreview modeで `tayori-preview-db` を指定する。Preview URLにもCloudflare Accessを適用する。

`production` Environmentには次を登録する。

| 種別 | 名前 | 値 |
|---|---|---|
| Variable | `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| Variable | `TAYORI_D1_DATABASE_ID` | `tayori-db`作成時に表示されたUUID |
| Secret | `CLOUDFLARE_API_TOKEN` | 本番用API Token |
| Secret | `ACCESS_TEAM_DOMAIN` | Cloudflare Accessチームドメイン |
| Secret | `ACCESS_AUD` | AccessアプリのAudience |
| Secret | `ALLOWED_EMAIL` | 許可する本人メールアドレス |

### 4. Workers Buildsとの二重配備を防ぐ

GitHub Actionsを唯一のデプロイ経路にするため、Cloudflare Dashboardの既存Worker `tayori` で **Settings → Builds** を開き、接続済みGitリポジトリを切断する。`tayori-app`、`tayori-collector-preview`、`tayori-collector`もWorkers Buildsに接続しない。Cloudflare連携のBuild checkが残っていないことを次のpushで確認する。

### 5. 初回配備を確認

この変更をGitHubへpushするとPreview workflowが起動する。成功後、Actionsログに出る `tayori-app` のPreview URLとCloudflare Accessの保護状態を確認する。ProductionはEnvironmentsとCloudflareリソースの準備後に、`main`上のコミットへ`vX.Y.Z`タグを付けて配備する。

現在の自動テストはcollectorのフィード解析が中心。appはテスト未作成を許容しており、認証・API・D1・Queue・UIの動作保証はまだ含まない。Semgrepは一般的な静的解析であり、Hono/Workers固有の問題や秘密情報の網羅的検出を保証しない。検出時はログで内容を確認して修正し、誤検出の抑制には理由を記録する。

ローカル環境で再現する場合は、次のコマンドを実行する。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
# Pythonの独立した仮想環境にsemgrep==1.178.0をインストールして実行
semgrep scan --config p/default --error --strict --metrics=off --disable-version-check apps packages
```

## 本番Environmentの準備

GitHub Settings → Environmentsで `production` を作成し、以下を登録する。Environmentのデプロイ対象は `v*` タグに限定する。Rulesetsでmainへの直接pushとリリースタグの変更・削除を制限し、タグ作成者を管理する。これらのGitHub側設定はまだ適用していない。手動承認を追加したい場合は、利用プランで対応するEnvironmentのrequired reviewersを設定する。

| 種別 | 名前 | 内容 |
|---|---|---|
| Variable | CLOUDFLARE_ACCOUNT_ID | 本番のCloudflareアカウントID |
| Variable | TAYORI_D1_DATABASE_ID | 本番D1のUUID。両Workerのビルドとmigrationで同じ値を利用 |
| Secret | CLOUDFLARE_API_TOKEN | 対象アカウントに限定したWorkersデプロイ、D1 migration、Queue設定に必要な権限のトークン |
| Secret | ACCESS_TEAM_DOMAIN | Accessチームドメイン |
| Secret | ACCESS_AUD | AccessアプリのAudience |
| Secret | ALLOWED_EMAIL | 許可する本人メール |

`preview` Environmentには `CLOUDFLARE_ACCOUNT_ID`、`TAYORI_PREVIEW_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN` を登録する。`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ALLOWED_EMAIL` は `tayori-app` のCloudflare Previews Base secretsに設定する。`preview`で使用するAPI Tokenは本番用と分ける。

D1 `tayori-db`、Queue `tayori-jobs`、Accessアプリと本番の公開経路を事前に準備する。CDはD1/Queueの初期作成とAccessポリシー作成を行わない。appデプロイ後にcollectorのCron/Queue設定も反映されるので、収集開始可能な状態にしておく。監視ログ・トレースの本番設定も初回リリース前に確認する。

本番Secretsはビルド後のデプロイ工程にだけ渡す。アプリ用の値は一時JSONファイルに書き、終了時に削除する。Preview用SecretsはCloudflare Previews Baseで管理する。APIトークンは一時JSONに含めない。タグとコミット、ジョブ結果はActions Summaryに残し、個々のWorkerの更新結果はログで確認する。

設定と検査を終えた後、担当者が次のコマンドでリリースする。

```sh
git switch main
git pull --ff-only
git tag -a v0.1.0 -m 'Release v0.1.0'
git push origin v0.1.0
```

Securityの指摘が残っている間はリリースも停止する。Snyk移行後にnpm auditを外す場合は、mainにSnyk必須チェックとPR経由の更新制限が適用されていることを確認する。SnykのPR検査はタグでは再実行されない。

## 初回のローカル検証（2026-09-30）

- actionlintで両ワークフローの構文検証に成功。
- npm ci、型チェック、collectorの8テスト、両Workerのビルドに成功。appはテスト未作成。
- npm auditはhigh 1件、moderate 4件で失敗。Cloudflare開発ツールのminiflare配下にあるundiciが対象で、監査結果は修正版なしと報告している。合格基準を緩めず、依存ツールの対応を別途確認する。
- Semgrepのローカル実行は環境作成の権限制限と追加許可の見送りにより未検証。GitHub Actions上での実行も未確認。
- CD追加後、3ワークフローの構文検証、型チェック、8テスト、両Workerのビルドに成功。タグ名とmain所属判定は一時Gitリポジトリで正常系・拒否系の6ケースを確認。本番の認証情報登録・タグpush・実デプロイは未実施。

参考: [SemgrepのCI設定](https://semgrep.dev/docs/semgrep-ci/sample-ci-configs)、[setup-node](https://github.com/actions/setup-node)、[Snyk GitHub連携](https://github.com/snyk/user-docs/blob/main/developer-tools/scm-integrations/organization-level-integrations/github.md)、[Snyk PRチェック](https://learn.snyk.io/lesson/checking-your-code-with-pr-checks/)。
