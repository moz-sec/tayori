/** Explains persisted Collector error codes without exposing feed response bodies. */
export function feedErrorMessage(code: string): string {
  if (code === "invalid_feed") return "RSS / Atomとして解析できないか、フィードのサイズ・記事数が上限を超えています。配信元を確認してください。";
  if (code === "unsafe_feed_url") return "安全に取得できないURLのため、取得を止めました。配信先・転送先URLを確認してください。";
  if (code === "redirect_limit") return "転送先を確認できないか、転送回数が上限を超えています。RSSのURLを確認してください。";
  if (code === "http_401" || code === "http_403") return "配信元がアクセスを許可していません。公開されたRSSのURLか確認してください。";
  if (code === "http_404" || code === "http_410") return "フィードが見つからないか、公開を終了しています。RSSのURLを確認してください。";
  if (code === "http_429") return "配信元のアクセス制限により取得できません。しばらく待ってから配信元の状態を確認してください。";
  if (/^http_5\d{2}$/.test(code)) return "配信元のサーバーでエラーが発生しています。しばらく待ってから配信元の状態を確認してください。";
  if (/^http_\d{3}$/.test(code)) return "配信元が正常な応答を返しませんでした。RSSのURLや配信元の状態を確認してください。";
  return "取得時にエラーが発生しました。エラーコードと配信元の状態を確認してください。";
}
