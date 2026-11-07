import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { D1UsageNotice } from "./D1UsageNotice";

it("explains the stop reason and how monitoring can resume", () => {
  const unavailable = renderToStaticMarkup(
    createElement(D1UsageNotice, {
      status: { state: "stopped", reason: "unavailable", metrics: [], snapshot: null },
    }),
  );
  expect(unavailable).toContain("利用量を確認できない");
  expect(unavailable).toContain("取得できると再開");
  const limited = renderToStaticMarkup(
    createElement(D1UsageNotice, {
      status: { state: "stopped", reason: "limit_reached", metrics: ["rowsRead"], snapshot: null },
    }),
  );
  expect(limited).toContain("読み取り行数");
  expect(limited).toContain("上限を下回ると再開");
});
