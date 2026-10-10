import process from "node:process";
import { bindings, defineConfig } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "tayori-app",
    compatibilityDate: "2026-09-29",
    entrypoint,
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    env: {
      DB: bindings.d1({ name: "tayori-db", id: process.env.TAYORI_D1_DATABASE_ID ?? "00000000-0000-4000-8000-000000000001" }),
      ACCESS_TEAM_DOMAIN: bindings.secret(),
      ACCESS_AUD: bindings.secret(),
      ALLOWED_EMAIL: bindings.secret(),
    },
  },
});
