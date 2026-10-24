import process from "node:process";
import { bindings, defineConfig, triggers } from "cf/config";
import type { QueueMessage } from "@tayori/shared";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  const preview = mode === "preview";
  const queueName = preview ? "tayori-preview-jobs" : "tayori-jobs";

  return {
    worker: {
      name: preview ? "tayori-collector-preview" : "tayori-collector",
      compatibilityDate: "2026-09-29",
      entrypoint,
      observability: {
        enabled: true,
        logs: { enabled: true, headSamplingRate: 1 },
        traces: { enabled: true, headSamplingRate: 1 },
      },
      env: {
        DB: bindings.d1({
          name: preview ? "tayori-preview-db" : "tayori-db",
          id: (preview ? process.env.TAYORI_PREVIEW_D1_DATABASE_ID : process.env.TAYORI_D1_DATABASE_ID)
            ?? "00000000-0000-4000-8000-000000000001",
        }),
        JOBS: bindings.queue<QueueMessage>({ name: queueName }),
      },
      triggers: [
        triggers.scheduled({ schedule: "0 * * * *" }),
        triggers.queue({
          name: queueName,
          maxBatchSize: 1,
          maxConcurrency: 1,
          maxRetries: 1,
        }),
      ],
      workersDev: false,
      previewUrls: false,
    },
  };
});
