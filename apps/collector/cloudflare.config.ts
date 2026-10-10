import process from "node:process";
import { bindings, defineConfig, triggers } from "cf/config";
import type { QueueMessage } from "@tayori/shared";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "tayori-collector",
    compatibilityDate: "2026-09-29",
    entrypoint,
    env: {
      DB: bindings.d1({ name: "tayori-db", id: process.env.TAYORI_D1_DATABASE_ID ?? "00000000-0000-4000-8000-000000000001" }),
      JOBS: bindings.queue<QueueMessage>({ name: "tayori-jobs" }),
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
    workersDev: false,
    previewUrls: false,
  },
});
