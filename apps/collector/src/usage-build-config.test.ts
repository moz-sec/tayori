import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("validates and binds enabled account and mode-specific database IDs in the actual build", () => {
  const base = {
    ...process.env,
    TAYORI_D1_USAGE_ENABLED: "true",
    CLOUDFLARE_ACCOUNT_ID: "",
    TAYORI_D1_DATABASE_ID: "",
    TAYORI_PREVIEW_D1_DATABASE_ID: "",
  };
  const build = (env: NodeJS.ProcessEnv, preview = false) =>
    spawnSync(
      process.execPath,
      ["../../node_modules/vite/bin/vite.js", "build", ...(preview ? ["--mode", "preview"] : [])],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
  const missingAccount = build({ ...base, CLOUDFLARE_ACCOUNT_ID: "  " });
  expect(missingAccount.status).not.toBe(0);
  expect(missingAccount.stderr).toContain("CLOUDFLARE_ACCOUNT_ID is required");
  const missingDatabase = build({
    ...base,
    CLOUDFLARE_ACCOUNT_ID: "account",
    TAYORI_D1_DATABASE_ID: "  ",
  });
  expect(missingDatabase.status).not.toBe(0);
  expect(missingDatabase.stderr).toContain("TAYORI_D1_DATABASE_ID is required");
  const missingPreview = build(
    { ...base, CLOUDFLARE_ACCOUNT_ID: "account", TAYORI_D1_DATABASE_ID: "production" },
    true,
  );
  expect(missingPreview.status).not.toBe(0);
  expect(missingPreview.stderr).toContain("TAYORI_PREVIEW_D1_DATABASE_ID is required");
  expect(build({ ...base, TAYORI_D1_USAGE_ENABLED: "false" }).status).toBe(0);
  expect(
    build({ ...base, CLOUDFLARE_ACCOUNT_ID: "account", TAYORI_D1_DATABASE_ID: "production" })
      .status,
  ).toBe(0);
  const production: unknown = JSON.parse(
    readFileSync(".cloudflare/output/v0/workers/default/worker.config.json", "utf8"),
  );
  expect(production).toMatchObject({
    env: { D1_ACCOUNT_ID: { value: "account" }, D1_DATABASE_ID: { value: "production" } },
  });
  expect(
    build(
      { ...base, CLOUDFLARE_ACCOUNT_ID: "account", TAYORI_PREVIEW_D1_DATABASE_ID: "preview" },
      true,
    ).status,
  ).toBe(0);
  const preview: unknown = JSON.parse(
    readFileSync(".cloudflare/output/v0/workers/default/worker.config.json", "utf8"),
  );
  expect(preview).toMatchObject({
    env: { D1_ACCOUNT_ID: { value: "account" }, D1_DATABASE_ID: { value: "preview" } },
  });
}, 30000);
