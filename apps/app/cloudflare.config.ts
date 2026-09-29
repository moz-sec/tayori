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
      DB: bindings.d1({ name: "tayori-db", id: "00000000-0000-0000-0000-000000000000" }),
    },
  },
});
