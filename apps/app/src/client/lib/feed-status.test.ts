import { describe, expect, it } from "vitest";
import { feedErrorMessage } from "./feed-status";

describe("feed error explanations", () => {
  it.each([
    ["invalid_feed", "解析できない"], ["unsafe_feed_url", "安全に取得できない"],
    ["redirect_limit", "転送"], ["http_401", "アクセスを許可"], ["http_403", "アクセスを許可"],
    ["http_404", "見つからない"], ["http_410", "公開を終了"], ["http_429", "アクセス制限"],
    ["http_503", "サーバー"], ["http_418", "正常な応答"], ["future_code", "エラーコード"],
  ])("explains %s", (code, text) => expect(feedErrorMessage(code)).toContain(text));
});
