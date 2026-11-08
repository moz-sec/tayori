import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  const reset = await request.post("/__e2e/reset", {
    headers: { Origin: "http://127.0.0.1:4173" },
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("article")).toHaveCount(50);
});

test("購読の登録・編集・移動・確認付き解除と既存記事の保持", async ({ page }) => {
  const create = page
    .locator("form")
    .filter({ has: page.getByPlaceholder("https://example.com/feed.xml") });
  await create
    .getByPlaceholder("https://example.com/feed.xml")
    .fill("https://example.com/added.xml");
  await create.getByPlaceholder("表示名（任意）").fill("追加購読");
  await create.getByRole("button", { name: "購読先を追加", exact: true }).click();
  await expect(page.getByRole("button", { name: "追加購読の購読設定", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "テスト購読の購読設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "購読設定：テスト購読", exact: true });
  await dialog.getByLabel("表示名", { exact: true }).fill("編集済み購読");
  await dialog
    .getByLabel("RSS / Atom URL", { exact: true })
    .fill("https://example.com/changed.xml");
  await dialog.getByRole("combobox", { name: "所属フォルダ", exact: true }).selectOption("other");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const settings = page.getByRole("button", { name: "編集済み購読の購読設定", exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  const edited = page.getByRole("dialog", { name: "購読設定：編集済み購読", exact: true });
  await expect(edited.getByRole("combobox", { name: "所属フォルダ", exact: true })).toHaveValue(
    "other",
  );
  await expect(edited.getByLabel("RSS / Atom URL", { exact: true })).toHaveValue(
    "https://example.com/changed.xml",
  );
  await edited.getByRole("button", { name: "購読解除…", exact: true }).click();
  await expect(
    edited.getByRole("button", { name: "確認して購読解除", exact: true }),
  ).toBeDisabled();
  await edited.getByRole("checkbox").check();
  await edited.getByRole("button", { name: "確認して購読解除", exact: true }).click();
  await expect(edited).not.toBeVisible();
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更新", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("link", { name: "テスト記事 01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "さらに読み込む", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(55);
});

test("フォルダ作成・折りたたみの保持・並べ替え・削除時の移動", async ({ page, request }) => {
  await page.getByRole("button", { name: "フォルダを作成", exact: true }).click();
  const create = page.getByRole("dialog", { name: "フォルダを作成", exact: true });
  await create.getByLabel("フォルダ名").fill("新規フォルダ");
  await create.getByRole("button", { name: "フォルダを作成", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(page.getByRole("button", { name: "新規フォルダの操作", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "親フォルダを折りたたむ", exact: true }).click();
  await expect(page.getByRole("button", { name: "子フォルダの操作", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "親フォルダを展開", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "親フォルダを展開", exact: true }).click();
  const beforeMove = (await (await request.get("/api/v1/folders")).json()).data
    .filter((folder: { parentId: string | null }) => !folder.parentId)
    .map((folder: { id: string }) => folder.id);
  await page.getByRole("button", { name: "親フォルダの操作", exact: true }).click();
  await page.getByRole("button", { name: "親フォルダを下へ移動", exact: true }).click();
  await expect
    .poll(async () => {
      const result = await (await request.get("/api/v1/folders")).json();
      return result.data
        .filter((folder: { parentId: string | null }) => !folder.parentId)
        .map((folder: { id: string }) => folder.id)
        .indexOf("parent");
    })
    .toBe(beforeMove.indexOf("parent") + 1);
  await page.getByRole("button", { name: "子フォルダの操作", exact: true }).click();
  await page.getByRole("button", { name: "「子フォルダ」のフォルダ設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "フォルダ設定", exact: true });
  await dialog.getByRole("button", { name: "フォルダを削除", exact: true }).click();
  await expect(
    dialog.getByText("直下の子フォルダと購読先は親フォルダ「親フォルダ」へ移動します。", {
      exact: false,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "確認して削除", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "子フォルダの操作", exact: true })).toHaveCount(0);
  expect((await (await request.get("/api/v1/sources")).json()).data[0].folderId).toBe("parent");
  await page.getByRole("button", { name: "親フォルダの操作", exact: true }).click();
  await page.getByRole("button", { name: "「親フォルダ」のフォルダ設定", exact: true }).click();
  await dialog.getByRole("button", { name: "フォルダを削除", exact: true }).click();
  await dialog.getByRole("button", { name: "確認して削除", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get("/api/v1/sources")).json()).data[0].folderId).toBeNull();
  await expect(
    page.getByRole("button", { name: "テスト購読の購読設定", exact: true }),
  ).toBeVisible();
});

test("記事選択・既読・保存・ページングと再読み込み後の状態", async ({ page }) => {
  await page.getByRole("checkbox", { name: "「テスト記事 01」を選択", exact: true }).check();
  await page.getByRole("checkbox", { name: "「テスト記事 02」を選択", exact: true }).check();
  await page.getByRole("button", { name: "選択した記事を既読（2件）", exact: true }).click();
  const first = page
    .locator("article")
    .filter({ has: page.getByRole("link", { name: "テスト記事 01", exact: true }) });
  await expect(first.getByRole("button", { name: "未読に戻す", exact: true })).toBeVisible();
  await first.getByRole("button", { name: "あとで読む", exact: true }).click();
  await expect(first.getByRole("button", { name: "あとで読む", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await first.getByRole("button", { name: "お気に入り", exact: true }).click();
  await page.getByRole("button", { name: "さらに読み込む", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(55);
  await expect(page.getByRole("button", { name: "さらに読み込む", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(first.getByRole("button", { name: "あとで読む", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(first.getByRole("button", { name: "未読に戻す", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "記事の絞り込み" })
    .getByRole("link", { name: "お気に入り", exact: true })
    .click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "テスト記事 01", exact: true })).toBeVisible();
});

test("画面復帰で別端末変更を反映しダイアログからフォーカスを戻す", async ({
  page,
  context,
  request,
}) => {
  const settings = page.getByRole("button", { name: "テスト購読の購読設定", exact: true });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "購読設定：テスト購読", exact: true });
  await expect(dialog.getByLabel("表示名", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(settings).toBeFocused();
  // Advance the documented focus cooldown without a fixed wall-clock wait.
  await page.clock.install();
  await page.clock.fastForward(4_000);
  const other = await context.newPage();
  await other.goto("/");
  await other.bringToFront();
  const update = await request.patch("/api/v1/sources/seed-source", {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: { title: "別端末で変更" },
  });
  expect(update.ok()).toBeTruthy();
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/sources") && response.ok(),
  );
  await page.bringToFront();
  // Headless Chromium keeps tabs visible; deliver the return event to the real browser listener.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(
    page.getByRole("button", { name: "別端末で変更の購読設定", exact: true }),
  ).toBeVisible();
  await expect(settings).toHaveCount(0);
  await other.close();
});

test("収集設定を保存して再読み込みし、保存失敗時は入力を保持", async ({ page }) => {
  await page.getByRole("button", { name: "RSS収集設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "RSS収集設定", exact: true });
  const confirmed = dialog.getByRole("region", { name: "保存済みの収集設定" });
  await expect(confirmed).toContainText("保存済み：1時間ごと");
  await dialog.getByRole("combobox", { name: "収集方法", exact: true }).selectOption("daily");
  await dialog
    .getByRole("combobox", { name: "毎日の実行時刻（日本時間）", exact: true })
    .selectOption("9");
  await dialog.getByRole("button", { name: "収集設定を保存", exact: true }).click();
  await expect(confirmed).toContainText("保存済み：毎日 9:00（日本時間）");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "RSS収集設定", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "毎日の実行時刻（日本時間）", exact: true }),
  ).toHaveValue("9");
  await dialog.getByRole("combobox", { name: "収集方法", exact: true }).selectOption("interval");
  await dialog.getByRole("combobox", { name: "取得間隔", exact: true }).selectOption("6");
  await page.route("**/api/v1/settings/collection-schedule", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 503, json: { error: { code: "INTERNAL_ERROR" } } });
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "収集設定を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "取得間隔", exact: true })).toHaveValue("6");
  await expect(confirmed).toContainText("保存済み：毎日 9:00（日本時間）");
  await page.unroute("**/api/v1/settings/collection-schedule");
  await dialog.getByRole("button", { name: "収集設定を保存", exact: true }).click();
  await expect(confirmed).toContainText("保存済み：6時間ごと");
});

test("購読URLの競合後は最新一覧を読み込み、古い入力の再保存を防ぐ", async ({ page, request }) => {
  await page.getByRole("button", { name: "テスト購読の購読設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "購読設定：テスト購読", exact: true });
  await dialog
    .getByLabel("RSS / Atom URL", { exact: true })
    .fill("https://example.com/stale-draft.xml");
  const latest = await request.patch("/api/v1/sources/seed-source", {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: { title: "別端末URL", url: "https://example.com/latest.xml", expectedGeneration: 1 },
  });
  expect(latest.ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("設定を開き直して");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "閉じる", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "別端末URLの購読設定", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "購読設定：別端末URL" })
      .getByLabel("RSS / Atom URL", { exact: true }),
  ).toHaveValue("https://example.com/latest.xml");
});

test("小さい画面でもサイドバーをスクロールして収集設定へ移動できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await page.getByRole("button", { name: "サイドバーを開く", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "購読ナビゲーション" });
  await expect(drawer).toHaveCSS("pointer-events", "auto");
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(320);
  await drawer.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => drawer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(drawer.getByRole("button", { name: "RSS収集設定", exact: true })).toBeInViewport();
  await drawer.getByRole("button", { name: "RSS収集設定", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "RSS収集設定", exact: true })).toBeVisible();
});
