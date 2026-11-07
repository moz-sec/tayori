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
        ...(process.env.TAYORI_MONITORING_ENABLED === "true"
          ? {
              MONITOR_WEBHOOK_URL: bindings.secret(),
              MONITOR_TICK_STALE_SECONDS: bindings.text(
                process.env.MONITOR_TICK_STALE_SECONDS ?? "10800",
              ),
              MONITOR_BACKLOG_STALE_SECONDS: bindings.text(
                process.env.MONITOR_BACKLOG_STALE_SECONDS ?? "10800",
              ),
              MONITOR_FAILURE_THRESHOLD: bindings.text(
                process.env.MONITOR_FAILURE_THRESHOLD ?? "3",
              ),
            }
          : {}),
      },
      env: {
        DB: bindings.d1({
          name: preview ? "tayori-preview-db" : "tayori-db",
          id:
            (preview
              ? process.env.TAYORI_PREVIEW_D1_DATABASE_ID
              : process.env.TAYORI_D1_DATABASE_ID) ?? "00000000-0000-4000-8000-000000000001",
        }),
        JOBS: bindings.queue<QueueMessage>({ name: queueName }),
        ...(process.env.TAYORI_D1_USAGE_ENABLED === "true"
          ? {
              D1_USAGE_ENABLED: bindings.text("true"),
              D1_ANALYTICS_TOKEN: bindings.secret(),
              D1_ACCOUNT_ID: bindings.text(process.env.CLOUDFLARE_ACCOUNT_ID ?? ""),
              D1_DATABASE_ID: bindings.text(
                (preview
                  ? process.env.TAYORI_PREVIEW_D1_DATABASE_ID
                  : process.env.TAYORI_D1_DATABASE_ID) ?? "",
              ),
              D1_STORAGE_LIMIT_BYTES: bindings.text(
                process.env.D1_STORAGE_LIMIT_BYTES ?? "419430400",
              ),
              D1_ROWS_READ_LIMIT: bindings.text(process.env.D1_ROWS_READ_LIMIT ?? "3000000"),
              D1_ROWS_WRITTEN_LIMIT: bindings.text(process.env.D1_ROWS_WRITTEN_LIMIT ?? "60000"),
              D1_WARNING_RATIO: bindings.text(process.env.D1_WARNING_RATIO ?? "0.875"),
              D1_MAX_AGE_SECONDS: bindings.text(process.env.D1_MAX_AGE_SECONDS ?? "7200"),
            }
          : {}),
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
