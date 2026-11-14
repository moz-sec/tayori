import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.visual.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "../../output/playwright/test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:4173/api/v1/health",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      XDG_CONFIG_HOME: fileURLToPath(new URL("./.cloudflare/e2e-config", import.meta.url)),
      ACCESS_TEAM_DOMAIN: "e2e.invalid",
      ACCESS_AUD: "e2e-only",
      ALLOWED_EMAIL: "e2e@example.invalid",
      CHOKIDAR_USEPOLLING: "1",
    },
  },
});
