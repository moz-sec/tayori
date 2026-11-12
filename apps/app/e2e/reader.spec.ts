import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  const reset = await request.post("/__e2e/reset", {
    headers: { Origin: "http://127.0.0.1:4173" },
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("article")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "親フォルダを展開", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "「子フォルダ」のフォルダ設定", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "親フォルダを展開", exact: true }).click();
  await page.getByRole("button", { name: "子フォルダを展開", exact: true }).click();
});

test("サイドバーの開閉ボタンはそれぞれの表示状態にだけ現れる", async ({ page }) => {
  const open = page.getByRole("button", { name: "サイドバーを開く", exact: true });
  const close = page.getByRole("button", { name: "サイドバーを閉じる", exact: true });
  await expect(open).toHaveCount(0);
  await expect(close).toBeVisible();
  await close.click();
  await expect(open).toBeVisible();
  await expect(open).toBeFocused();
  await expect(close).not.toBeVisible();
  await open.click();
  await expect(open).toHaveCount(0);
  await expect(close).toBeVisible();
  await expect(close).toBeFocused();
});

test("フォルダと購読先を階層に応じて字下げする", async ({ page }) => {
  const parent = await page.getByRole("button", { name: "親フォルダを折りたたむ" }).boundingBox();
  const child = await page.getByRole("button", { name: "子フォルダを折りたたむ" }).boundingBox();
  const source = await page.locator('a[title="テスト購読"]').boundingBox();
  expect(parent).not.toBeNull();
  expect(child).not.toBeNull();
  expect(source).not.toBeNull();
  expect(child!.x).toBeGreaterThan(parent!.x);
  expect(source!.x).toBeGreaterThan(child!.x);
  expect(child!.y).toBeGreaterThan(parent!.y);
  expect(source!.y).toBeGreaterThan(child!.y);
});

test("フォルダと購読先の未読数と設定ボタンを右端で揃える", async ({ page }) => {
  const folder = page.locator(".tayori-folder-row").filter({ hasText: "子フォルダ" });
  const source = page.locator(".tayori-source-row").filter({ hasText: "テスト購読" });
  for (const selector of [".badge", 'button[title$="設定"]']) {
    const folderBox = await folder.locator(selector).boundingBox();
    const sourceBox = await source.locator(selector).boundingBox();
    expect(folderBox).not.toBeNull();
    expect(sourceBox).not.toBeNull();
    expect(folderBox!.x + folderBox!.width).toBeCloseTo(sourceBox!.x + sourceBox!.width, 0);
  }
});

test("ファビコンを取得できない場合はRSSアイコンにする", async ({ page }) => {
  const source = page.locator(".tayori-source-row").filter({ hasText: "テスト購読" });
  await expect(source.locator(".tayori-source-icon-fallback")).toBeVisible();
});

test("購読先のメニューから追加とOPML取り込みを開ける", async ({ page }) => {
  const add = page.getByRole("button", { name: "購読先やフォルダを追加" });
  await add.click();
  await page.getByRole("button", { name: "購読先を追加", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "購読先を追加", exact: true });
  await expect(settings.getByLabel("RSS / Atom URL", { exact: true })).toBeFocused();
  await settings.getByRole("button", { name: "閉じる" }).click();
  await expect(add).toBeFocused();

  const more = page.getByRole("button", { name: "購読先のその他の操作" });
  await more.click();
  await page.getByRole("button", { name: "OPMLをインポート" }).click();
  const opml = page.getByRole("dialog", { name: "OPML", exact: true });
  await expect(opml.getByRole("button", { name: "インポート", exact: true })).toBeFocused();
  await opml.getByRole("button", { name: "閉じる" }).click();
  await expect(more).toBeFocused();
  await more.click();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();
});

test("購読の登録・編集・移動・確認付き解除と既存記事の保持", async ({ page }) => {
  await page.getByRole("button", { name: "購読先やフォルダを追加" }).click();
  await page.getByRole("button", { name: "購読先を追加", exact: true }).click();
  const create = page
    .locator("form")
    .filter({ has: page.getByLabel("RSS / Atom URL", { exact: true }) });
  await create
    .getByLabel("RSS / Atom URL", { exact: true })
    .fill("https://tayori.invalid/added.xml");
  await create.getByPlaceholder("表示名（任意）").fill("追加購読");
  await create.getByRole("button", { name: "購読先を追加", exact: true }).click();
  await expect(page.getByText("購読先を追加しました。", { exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "購読先を追加" })
    .getByRole("button", { name: "閉じる" })
    .click();
  await expect(page.getByRole("button", { name: "追加購読の購読設定", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "テスト購読の購読設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "テスト購読", exact: true });
  await dialog.getByLabel("表示名", { exact: true }).fill("編集済み購読");
  await dialog
    .getByLabel("RSS / Atom URL", { exact: true })
    .fill("https://tayori.invalid/changed.xml");
  await dialog.getByRole("combobox", { name: "所属フォルダ", exact: true }).selectOption("other");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "移動先を展開", exact: true }).click();
  const settings = page.getByRole("button", { name: "編集済み購読の購読設定", exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  const edited = page.getByRole("dialog", { name: "編集済み購読", exact: true });
  await expect(edited.getByRole("combobox", { name: "所属フォルダ", exact: true })).toHaveValue(
    "other",
  );
  await expect(edited.getByLabel("RSS / Atom URL", { exact: true })).toHaveValue(
    "https://tayori.invalid/changed.xml",
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

test("購読設定で取得状況を確認できる", async ({ page }) => {
  await page.getByRole("button", { name: "テスト購読の購読設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "テスト購読", exact: true });
  const status = dialog.getByRole("region", { name: "取得状況" });
  await expect(status.locator("details")).not.toHaveAttribute("open");
  await status.getByText("取得状況", { exact: true }).click();
  await expect(status.getByText("次回対象時刻", { exact: true })).toBeVisible();
  await status.getByText("取得状況", { exact: true }).click();
  await expect(status.getByText("次回対象時刻", { exact: true })).not.toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "収集", exact: true })).toHaveCount(0);
});

test("フォルダ作成・折りたたみの保持・並べ替え・削除時の移動", async ({ page, request }) => {
  await page.getByRole("button", { name: "購読先やフォルダを追加" }).click();
  await page.getByRole("button", { name: "フォルダを作成", exact: true }).click();
  const create = page.getByRole("dialog", { name: "フォルダを作成", exact: true });
  await expect(create.getByLabel("親フォルダ")).toHaveCount(0);
  await create.getByLabel("フォルダ名").fill("新規フォルダ");
  await create.getByRole("button", { name: "フォルダを作成", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "「新規フォルダ」のフォルダ設定", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "親フォルダを折りたたむ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "「子フォルダ」のフォルダ設定", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "親フォルダを展開", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "親フォルダを展開", exact: true }).click();
  const beforeMove = (await (await request.get("/api/v1/folders")).json()).data
    .filter((folder: { parentId: string | null }) => !folder.parentId)
    .map((folder: { id: string }) => folder.id);
  await page.getByRole("link", { name: "親フォルダ" }).focus();
  await page.keyboard.press("Shift+F10");
  const moveDialog = page.getByRole("dialog", { name: "「親フォルダ」を移動", exact: true });
  await moveDialog.getByRole("button", { name: "下へ移動", exact: true }).click();
  await expect
    .poll(async () => {
      const result = await (await request.get("/api/v1/folders")).json();
      return result.data
        .filter((folder: { parentId: string | null }) => !folder.parentId)
        .map((folder: { id: string }) => folder.id)
        .indexOf("parent");
    })
    .toBe(beforeMove.indexOf("parent") + 1);
  await moveDialog.getByRole("button", { name: "閉じる", exact: true }).click();
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
  await expect(
    page.getByRole("button", { name: "「子フォルダ」のフォルダ設定", exact: true }),
  ).toHaveCount(0);
  expect((await (await request.get("/api/v1/sources")).json()).data[0].folderId).toBe("parent");
  await page.getByRole("button", { name: "「親フォルダ」のフォルダ設定", exact: true }).click();
  await dialog.getByRole("button", { name: "フォルダを削除", exact: true }).click();
  await dialog.getByRole("button", { name: "確認して削除", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get("/api/v1/sources")).json()).data[0].folderId).toBeNull();
  await expect(
    page.getByRole("button", { name: "テスト購読の購読設定", exact: true }),
  ).toBeVisible();
});

test("購読先の文字をドラッグしてフォルダへ移動する", async ({ page, request }) => {
  const source = page.getByRole("link", { name: "テスト購読" });
  const folder = page.locator(".tayori-folder-row").filter({ hasText: "親フォルダ" });
  await expect(source).toHaveAttribute("draggable", "false");
  const sourceBox = (await source.locator("span").first().boundingBox())!;
  const targetBox = (await folder.boundingBox())!;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
    .toBe("parent");
  await page.reload();
  await expect
    .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
    .toBe("parent");
});

test("長押ししてドラッグで購読先とフォルダを移動する", async ({ page, request }) => {
  const parentRow = page.locator(".tayori-folder-row").filter({ hasText: "親フォルダ" });
  const drag = async (
    name: string,
    target: import("@playwright/test").Locator,
    yOffset?: number,
  ) => {
    const link = page.getByRole("link", { name });
    const box = (await link.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator(".tayori-drop-root")).toBeVisible();
    const destination = (await target.boundingBox())!;
    await page.mouse.move(
      destination.x + destination.width / 2,
      destination.y + (yOffset ?? destination.height / 2),
      { steps: 5 },
    );
    await page.mouse.up();
  };
  await drag("テスト購読", parentRow);
  await expect
    .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
    .toBe("parent");
  await drag("子フォルダ", page.locator(".tayori-drop-root"));
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/folders")).json()).data.find(
          (folder: { id: string }) => folder.id === "child",
        ).parentId,
    )
    .toBeNull();
  await drag("子フォルダ", parentRow);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/folders")).json()).data.find(
          (folder: { id: string }) => folder.id === "child",
        ).parentId,
    )
    .toBe("parent");
  await drag("テスト購読", page.locator(".tayori-drop-root"));
  await expect
    .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
    .toBeNull();
});

test("長押ししてフォルダを同じ階層で並べ替える", async ({ page, request }) => {
  await page.getByRole("button", { name: "購読先やフォルダを追加" }).click();
  await page.getByRole("button", { name: "フォルダを作成", exact: true }).click();
  const create = page.getByRole("dialog", { name: "フォルダを作成" });
  await create.getByLabel("フォルダ名").fill("別フォルダ");
  await create.getByRole("button", { name: "フォルダを作成" }).click();
  const before = (await (await request.get("/api/v1/folders")).json()).data.filter(
    (folder: { parentId: string | null }) => folder.parentId === null,
  );
  const moving = before.at(-1);
  const source = (await page.getByRole("link", { name: moving.name }).boundingBox())!;
  const target = (await page
    .locator(".tayori-folder-row")
    .filter({ hasText: before[0].name })
    .boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await expect(page.locator(".tayori-drop-root")).toBeVisible();
  await page.mouse.move(target.x + 80, target.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await (await request.get("/api/v1/folders")).json()).data
        .filter((folder: { parentId: string | null }) => folder.parentId === null)
        .map((folder: { id: string }) => folder.id)
        .indexOf(moving.id),
    )
    .toBe(0);
});

test.describe("タッチ操作", () => {
  test.use({ hasTouch: true });
  test("長押しした購読先をタッチでドラッグできる", async ({ page, request, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const open = page.getByRole("button", { name: "サイドバーを開く" });
    await expect(open).toBeVisible();
    await open.tap();
    const source = (await page.getByRole("link", { name: "テスト購読" }).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: source.x + source.width / 2, y: source.y + source.height / 2 }],
    });
    await expect(page.locator(".tayori-drop-root")).toBeVisible();
    const target = (await page
      .locator(".tayori-folder-row")
      .filter({ hasText: "親フォルダ" })
      .boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2 }],
    });
    await expect(page.locator(".tayori-folder-row").filter({ hasText: "親フォルダ" })).toHaveClass(
      /tayori-drop-inside/,
    );
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
      .toBe("parent");
  });
  test("長押しで購読先の移動先を選べる", async ({ page, request, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const open = page.getByRole("button", { name: "サイドバーを開く" });
    await expect(open).toBeVisible();
    await open.tap();
    const box = (await page.getByRole("link", { name: "テスト購読" }).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(page.locator(".tayori-drop-root")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const dialog = page.getByRole("dialog", { name: "「テスト購読」を移動" });
    await dialog.getByLabel("移動先").selectOption("parent");
    await dialog.getByRole("button", { name: "移動", exact: true }).tap();
    await expect
      .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
      .toBe("parent");
  });
});

test("クリックで選択しキーボードで移動先を選べる", async ({ page, request }) => {
  const link = page.getByRole("link", { name: "テスト購読" });
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
  await link.focus();
  await page.keyboard.press("Shift+F10");
  const dialog = page.getByRole("dialog", { name: "「テスト購読」を移動" });
  await dialog.getByLabel("移動先").selectOption("parent");
  await dialog.getByRole("button", { name: "移動", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await (await request.get("/api/v1/sources")).json()).data[0].folderId)
    .toBe("parent");
  const parent = page.getByRole("link", { name: "親フォルダ" });
  await parent.focus();
  await page.keyboard.press("Shift+F10");
  const folderDialog = page.getByRole("dialog", { name: "「親フォルダ」を移動" });
  await expect(folderDialog.getByLabel("移動先").locator('option[value="child"]')).toHaveCount(0);
  await expect(folderDialog.getByRole("button", { name: "上へ移動" })).toBeVisible();
});

test("フォルダ設定を小さい画面でも操作できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const openSidebar = page.getByRole("button", { name: "サイドバーを開く", exact: true });
  await expect(openSidebar).toBeVisible();
  await openSidebar.click();
  await page.getByRole("button", { name: "「親フォルダ」のフォルダ設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "フォルダ設定", exact: true });
  await expect(dialog.getByRole("heading", { name: "フォルダ設定" })).toBeVisible();
  await expect(dialog.getByLabel("フォルダ名", { exact: true })).toBeVisible();
  expect(
    await dialog
      .locator(".modal-box")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("記事選択・既読・保存・ページングと再読み込み後の状態", async ({ page }) => {
  await page.getByRole("checkbox", { name: "「テスト記事 01」を選択", exact: true }).check();
  await page.getByRole("checkbox", { name: "「テスト記事 02」を選択", exact: true }).check();
  await page.getByRole("button", { name: "既読（2件）", exact: true }).click();
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
  const dialog = page.getByRole("dialog", { name: "テスト購読", exact: true });
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
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定", exact: true });
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
  await page.getByRole("button", { name: "設定", exact: true }).click();
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

test("OPMLを確認して取り込み、エクスポートできる", async ({ page }) => {
  await page.getByRole("button", { name: "購読先のその他の操作" }).click();
  await page.getByRole("button", { name: "OPMLをインポート" }).click();
  const dialog = page.getByRole("dialog", { name: "OPML", exact: true });
  await expect(dialog.getByRole("link", { name: "エクスポート", exact: true })).toHaveAttribute(
    "href",
    "/api/v1/subscriptions.opml",
  );
  await expect(dialog.getByRole("button", { name: "インポート", exact: true })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "feeds.opml",
    mimeType: "text/xml",
    buffer: Buffer.from(
      '<opml version="2.0"><body><outline text="追加" xmlUrl="https://tayori.invalid/import.xml" /></body></opml>',
    ),
  });
  await expect(dialog.getByText("1件の購読先を確認しました")).toBeVisible();
  await dialog.getByRole("button", { name: "確認して取り込む" }).click();
  await expect(dialog.getByText(/すべて取り込みました/)).toBeVisible();
});

test("設定画面の左右どちらからもスクロールできる", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 360 });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定", exact: true });
  const scroller = dialog.locator(".tayori-settings");
  await dialog.locator(".tayori-settings-nav").hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  const bounds = (await scroller.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 60, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: "収集設定を保存" })).toBeInViewport();
});

test("購読URLの競合後は最新一覧を読み込み、古い入力の再保存を防ぐ", async ({ page, request }) => {
  await page.getByRole("button", { name: "テスト購読の購読設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "テスト購読", exact: true });
  await dialog
    .getByLabel("RSS / Atom URL", { exact: true })
    .fill("https://tayori.invalid/stale-draft.xml");
  const latest = await request.patch("/api/v1/sources/seed-source", {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: {
      title: "別端末URL",
      url: "https://tayori.invalid/latest.xml",
      expectedGeneration: 1,
    },
  });
  expect(latest.ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("設定を開き直して");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "閉じる", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "別端末URLの購読設定", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "別端末URL" }).getByLabel("RSS / Atom URL", { exact: true }),
  ).toHaveValue("https://tayori.invalid/latest.xml");
});

test("小さい画面でもサイドバーをスクロールして収集設定へ移動できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await page.getByRole("button", { name: "サイドバーを開く", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "購読ナビゲーション" });
  await expect(drawer).toHaveCSS("pointer-events", "auto");
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(320);
  const settings = drawer.getByRole("button", { name: "設定", exact: true });
  await expect(settings).toBeInViewport();
  const initialPosition = (await settings.boundingBox())!;
  await drawer.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => drawer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(settings).toBeInViewport();
  expect(Math.abs((await settings.boundingBox())!.y - initialPosition.y)).toBeLessThan(2);
  await settings.click();
  await expect(page.getByRole("dialog", { name: "設定", exact: true })).toBeVisible();
});
