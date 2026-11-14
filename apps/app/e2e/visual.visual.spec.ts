import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  const reset = await request.post("/__e2e/reset", {
    headers: { Origin: "http://127.0.0.1:4173" },
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("article")).toHaveCount(50);
  await page.locator("article time").evaluateAll((elements) => {
    for (const element of elements) element.textContent = "2026/01/01 00:00";
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== "passed") return;
  await testInfo.attach("画面", {
    body: await page.screenshot({ animations: "disabled", caret: "hide" }),
    contentType: "image/png",
  });
});

test("記事一覧とサイドバーの表示", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page).toHaveScreenshot("reader-desktop.png");
});

test("小さい画面の記事一覧", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole("button", { name: "サイドバーを開く" })).toBeVisible();
  await expect(page).toHaveScreenshot("reader-mobile.png");
});
