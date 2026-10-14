/** Converts API and browser error codes into messages suitable for display. */
export function humanError(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, string> = {
    ACCESS_NOT_CONFIGURED: "Cloudflare Access の設定が必要です。",
    AUTHENTICATION_REQUIRED: "認証が必要です。ページを再読み込みしてください。",
    ACCOUNT_NOT_ALLOWED: "このアカウントは利用を許可されていません。",
    INVALID_ACCESS_TOKEN: "認証を確認できませんでした。再度ログインしてください。",
    SOURCE_ALREADY_EXISTS: "この購読先はすでに登録されています。",
    INVALID_FEED_URL: "公開されているHTTP/HTTPSのフィードURLを入力してください。",
    VERSION_CONFLICT: "記事の状態が更新されました。再読み込みしてください。",
    ORIGIN_NOT_ALLOWED: "リクエストの送信元を確認できませんでした。",
    FOLDER_ALREADY_EXISTS: "同じ階層に同名のフォルダがあります。",
    FOLDER_CYCLE: "フォルダを自分自身や配下へ移動できません。",
    OPML_FEED_LIMIT: "OPMLの購読先は一度に200件までです。",
    INVALID_OPML: "OPMLファイルを読み込めませんでした。",
    OPML_FILE_TOO_LARGE: "OPMLファイルは1MB以下にしてください。",
    OPML_DOCTYPE_NOT_ALLOWED: "DOCTYPEを含むOPMLファイルは読み込めません。",
    OPML_TOO_DEEP: "OPMLのフォルダ階層が深すぎます。",
  };
  return messages[code] ?? `処理に失敗しました（${code}）。`;
}
