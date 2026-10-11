import process from "node:process";
import { bindings, defineConfig } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  const preview = mode === "preview";

  return {
    worker: {
      name: preview ? "tayori-app-preview" : "tayori-app",
      compatibilityDate: "2026-09-29",
      entrypoint,
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api/*"],
      },
      env: {
        DB: bindings.d1({
          name: preview ? "tayori-preview-db" : "tayori-db",
          id: (preview ? process.env.TAYORI_PREVIEW_D1_DATABASE_ID : process.env.TAYORI_D1_DATABASE_ID)
            ?? "00000000-0000-4000-8000-000000000001",
        }),
        ACCESS_TEAM_DOMAIN: bindings.secret(),
        ACCESS_AUD: bindings.secret(),
        ALLOWED_EMAIL: bindings.secret(),
      },
    },
  };
});
