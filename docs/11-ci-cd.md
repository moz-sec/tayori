# CI/CD設計

## 今回の範囲

プルリクエストでは CI を実行し、`main` への push では最新コミットをCloudflareプレビュー環境へ配備する。`vX.Y.Z`（例: `v0.1.0`）タグを push すると本番環境へリリースする。どちらもGitHub Actionsから実行し、日常のローカルデプロイは行わない。

`main` のappはCloudflare Workers Previewsとして `tayori-app` の下に配備し、Preview URLと本番Workerを分ける。D1は `tayori-preview-db` を使い、本番データを共有しない。collectorはQueue consumerとCron Triggerを使うためCloudflare Previewsでは実行できず、専用Worker `tayori-collector-preview` を使う。Preview collectorは `tayori-preview-db` と `tayori-preview-jobs` に接続する。Preview appのAccess認証値はCloudflareのPreviews Base secretsに登録する。mainの連続pushは同じconcurrencyグループで直列化し、古い実行をキャンセルして最新の状態を反映する。

## タグリリースの設計

Release ワークフローはタグ名を検証し、対象コミットが `origin/main` の履歴に含まれることを確認する。続いて Security ワークフローを再利用し、依存関係の監査と Semgrep を実行する。両方の検査に成功した場合だけ、production Environment で型チェック、テスト、ビルドを実行する。その後、D1 migration、app、collector の順に更新する。ビルド成果物は同じジョブ内で `cf deploy --prebuilt` に渡し、再ビルドしない。

本番更新は共通concurrencyグループで直列化し、進行中のデプロイを新しいタグでキャンセルしない。待機中の実行は新しい実行で置換される場合があるため、タグは前のリリース結果を確認してから打つ。タグの付け直しは禁止し、失敗時は影響を確認して同じ実行を再実行するか修正タグを作る。

D1 の変更は旧 Worker と互換性のある追加変更に限る。既存の migration は編集せず、新しい SQL ファイルを追加する。migration または Worker の更新中に失敗すると、それまでに成功した更新は残る。複数の Worker と D1 の更新は原子的ではなく、自動ロールバックもしない。古い Worker に戻す場合も、DB との互換性を確認してから行う。

## セキュリティ検査の役割分担

GitHub の Dependabot alerts で依存関係の既知の脆弱性を継続監視し、Renovate で npm と GitHub Actions の更新 PR を作成する。PR とリリースの検査には、GitHub Actions 上の npm audit と Semgrep CE を使う。

| 担当              | 対象・運用                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependabot alerts | 依存関係の既知の脆弱性を通知。Security and quality の Dependabot alerts で確認                                                                                 |
| Renovate          | npm workspaces と GitHub Actions の更新 PR。通常更新は日本時間の土曜8時から翌0時まで、同時に最大10件（既定値）。脆弱性修正は通常のスケジュールと上限を待たない |
| npm audit         | 開発依存を含む依存関係を PR・リリース・週次で検査し、high/critical を失敗とする                                                                                |
| Semgrep CE        | apps / packages のソースコードを PR・リリース・週次で解析                                                                                                      |

Community Cloud は通常4時間ごとに実行されるため、通常更新の時間帯を広く設ける。実際の PR 作成時刻は実行状況によって変わり、毎週の作成を保証するものではない。Renovate の PR は自動マージせず、CI を確認して手動でマージする。GitHub の Dependabot alerts は SHA 固定の GitHub Actions にはアラートを生成しないため、Actions の更新内容は別途確認する。

## Renovate の導入

1. [Renovate GitHub App](https://github.com/apps/renovate) を `moz-sec/tayori` にインストールし、Dependabot alerts の読み取り権限を確認する。
2. GitHub で Dependency graph と Dependabot alerts が有効であることを確認する。Security and quality の Dependabot alerts で npm の直接・間接依存を確認する。
3. Renovate が設定を読み込み、npm workspaces と GitHub Actions の更新を認識することを確認する。修正可能な脆弱性アラートがある場合は修正 PR を確認する。対象がない場合は、将来のアラートで動作を確認する。
4. GitHub Actions 上で npm audit と Semgrep が PR・リリース時に実行されることを確認する。
5. 上記を確認してから、重複 PR を避けるため GitHub の Dependabot security updates を無効にし、Dependabot alerts は有効のままにする。

Dependabot の通常のバージョン更新設定は削除する。Renovate App が利用可能になるまでは通常更新 PR が作成されない。Dependabot security updates は設定ファイルの削除だけでは無効にならないため、移行確認後に設定画面で別途停止する。

## 実行条件と合格基準

| ワークフロー / ジョブ             | 条件                                                  | 合格基準                                                                                                       |
| --------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| CI / Workflow lockfile            | main向けPR、手動                                      | gh actions-lock --verifyで全Workflowの依存関係と参照元を検証できる                                             |
| CI / Format, lint, test and build | main向けPR、手動                                      | npm ci、整形の確認、lint、型チェック、既存テスト、両Workerのビルドが成功                                       |
| Preview                           | mainへのpush                                          | 型チェック、テスト、collectorのビルド後、プレビューD1 migration、app Previewと専用collector Workerの配備が成功 |
| Security / Dependency audit       | 同上、リリースからの呼び出し、および毎週月曜09:23 JST | 開発依存を含むnpm auditでhigh/criticalがない                                                                   |
| Security / Semgrep                | 同上、リリースからの呼び出し、および毎週月曜09:23 JST | p/defaultの静的解析で検出がなく、解析エラーもない                                                              |
| Release                           | vX.Y.Zタグのpush                                      | main所属確認、Security、型チェック、テスト、ビルド成功後に本番へ反映                                           |

Node.js 24、Ubuntu 24.04を使用する。インストールはルートのpackage-lock.jsonを使う。セキュリティ検査はテストの成否に依存せず実行する。週次検査は変更がなくても新たな脆弱性情報・ルールを取り込むために行う。スケジュールはデフォルトブランチ上で実行され、開始時刻は遅延する場合がある。

## 権限と依存ツール

- GITHUB_TOKENはcontents: readのみ。checkout後に認証情報を残さない。
- pull_requestを使用し、pull_request_targetでPRのコードを実行しない。PRのCIにSecretsは不要。本番のSecretsはproduction Environmentにのみ登録する。
- Actionsは完全なコミットSHAで固定し、Renovateで週次の更新PRを作成する。自動マージは行わず、CIを確認して手動でマージする。
- Actionが実行するコミットを`.github/workflows/actions.lock`で固定する。Workflowの`uses:`には完全なバージョンタグを記載する。Dependabotは週次の更新PRを作成し、導入済みWorkflowの更新ではlockfileも更新する。
- Semgrep CEはバージョンを固定。Registryのp/defaultルールは最新を取得するため、判定は更新される。metricsとバージョン確認を無効化し、ソースや結果をSemgrepプラットフォームへアップロードする設定は使わない。
- npm auditは依存情報をnpm Registryへ送信する。取得障害や解析エラーもジョブ失敗として扱い、黙って検査を省略しない。
- 設定中のnpm Registry mirrorはRolldownのLinux向けoptional dependencyをlockfileに収録しないため、Linux runnerでは`npm ci`後に`@rolldown/binding-linux-x64-gnu`をlockfile非更新で追加する。Node 24 / x64 / glibc runnerを前提とする。mirrorが修正されたら暫定手順を削除できる。
- 非公開リポジトリで追加ライセンスを前提にしないため、今回CodeQLは採用しない。
- 同一PR・同一ブランチの古い実行をキャンセルし、各ジョブに時間制限を設ける。

## 運用と限界

GitHub に反映した後、Actions の初回実行を確認する。マージを制限する場合は、リポジトリの Rulesets または Branch protection で `Workflow lockfile`、`Test and build`、`Dependency audit`、`Semgrep` を必須チェックに設定する。ワークフローを追加しただけでは、チェックに失敗してもマージは止まらない。利用できる保護機能と Actions の実行枠は契約によって異なる。

### Workflow lockfileの更新

Workflowや`uses:`を追加・変更したら、リポジトリのルートで次のコマンドを実行する。GitHub CLIの認証と`github/gh-actions-lock`拡張が必要。

```sh
gh actions-lock
gh actions-lock --verify
```

生成されたWorkflowと`actions.lock`の差分を確認し、一緒にコミットする。lockfileは手で編集しない。CIの`Workflow lockfile`ジョブも`--verify`を実行し、依存関係の記録漏れや、Actionの参照元と記録の不整合を検出する。`gh-actions-lock`は`v0.4.0`に固定し、更新時はローカルとCIで同じバージョンを使って検証する。

Actionが内部で使う別のActionも固定対象になる。再利用Workflowの呼び出し先、`run:`で取得するnpm・Pythonパッケージ、コンテナイメージ、runnerのOSは対象外。`release.yml`から呼ぶ同一リポジトリの`security.yml`で使うActionは、`security.yml`自身のlockfileエントリで固定する。npm依存の管理は引き続き`package-lock.json`で行う。[GitHub公式ドキュメント](https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles)

### プレビューの初回準備

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

| 種別     | 名前                            | 値                                        |
| -------- | ------------------------------- | ----------------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID`         | CloudflareアカウントID                    |
| Variable | `TAYORI_PREVIEW_D1_DATABASE_ID` | `tayori-preview-db`作成時に表示されたUUID |
| Secret   | `CLOUDFLARE_API_TOKEN`          | プレビュー用API Token                     |

Cloudflare Dashboardで `tayori-app` の **Settings → Previews Base** を有効にし、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ALLOWED_EMAIL` をPreviews BaseのSecretsとして登録する。ProductionのSecretsはPreviewに自動継承されない。Preview用の `DB` bindingは`cloudflare.config.ts`がPreview modeで `tayori-preview-db` を指定する。Preview URLにもCloudflare Accessを適用する。

`production` Environmentには次を登録する。

| 種別     | 名前                    | 値                                |
| -------- | ----------------------- | --------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID            |
| Variable | `TAYORI_D1_DATABASE_ID` | `tayori-db`作成時に表示されたUUID |
| Secret   | `CLOUDFLARE_API_TOKEN`  | 本番用API Token                   |
| Secret   | `ACCESS_TEAM_DOMAIN`    | Cloudflare Accessチームドメイン   |
| Secret   | `ACCESS_AUD`            | AccessアプリのAudience            |
| Secret   | `ALLOWED_EMAIL`         | 許可する本人メールアドレス        |

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

| 種別     | 名前                  | 内容                                                                                   |
| -------- | --------------------- | -------------------------------------------------------------------------------------- |
| Variable | CLOUDFLARE_ACCOUNT_ID | 本番のCloudflareアカウントID                                                           |
| Variable | TAYORI_D1_DATABASE_ID | 本番D1のUUID。両Workerのビルドとmigrationで同じ値を利用                                |
| Secret   | CLOUDFLARE_API_TOKEN  | 対象アカウントに限定したWorkersデプロイ、D1 migration、Queue設定に必要な権限のトークン |
| Secret   | ACCESS_TEAM_DOMAIN    | Accessチームドメイン                                                                   |
| Secret   | ACCESS_AUD            | AccessアプリのAudience                                                                 |
| Secret   | ALLOWED_EMAIL         | 許可する本人メール                                                                     |

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

Securityの指摘が残っている間はリリースも停止する。npm audit と Semgrep はリリース時にも実行する。

## 初回のローカル検証（2026-09-30）

- actionlintで両ワークフローの構文検証に成功。
- npm ci、型チェック、collectorの8テスト、両Workerのビルドに成功。appはテスト未作成。
- npm auditはhigh 1件、moderate 4件で失敗。Cloudflare開発ツールのminiflare配下にあるundiciが対象で、監査結果は修正版なしと報告している。合格基準を緩めず、依存ツールの対応を別途確認する。
- Semgrepのローカル実行は環境作成の権限制限と追加許可の見送りにより未検証。GitHub Actions上での実行も未確認。
- CD追加後、3ワークフローの構文検証、型チェック、8テスト、両Workerのビルドに成功。タグ名とmain所属判定は一時Gitリポジトリで正常系・拒否系の6ケースを確認。本番の認証情報登録・タグpush・実デプロイは未実施。

参考: [SemgrepのCI設定](https://semgrep.dev/docs/semgrep-ci/sample-ci-configs)、[setup-node](https://github.com/actions/setup-node)、[Dependabot alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts)、[Renovate vulnerability alerts](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts)。
