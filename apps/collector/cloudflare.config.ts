import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "tayori-collector",
    compatibilityDate: "2026-09-29",
    entrypoint,
    env: {
      DB: bindings.d1({ name: "tayori-db", id: "00000000-0000-0000-0000-000000000000" }),
      JOBS: bindings.queue({ name: "tayori-jobs" }),
    },
    triggers: [
      triggers.scheduled({ schedule: "*/5 * * * *" }),
      triggers.queue({
        name: "tayori-jobs",
        maxBatchSize: 1,
        maxConcurrency: 1,
        maxRetries: 1,
      }),
    ],
  },
});
