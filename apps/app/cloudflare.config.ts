import process from "node:process";
import { bindings, defineConfig } from "cf/config";
import type { QueueMessage } from "@tayori/shared";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ isPreview, mode }) => {
  const preview = isPreview || mode === "preview";
  const queueName = preview ? "tayori-preview-jobs" : "tayori-jobs";

  return {
    worker: {
      // Native Workers Previews are deployments of this Worker, not a second
      // Worker script. The mode selects Preview-safe bindings for cf previews.
      name: "tayori-app",
      compatibilityDate: "2026-09-29",
      entrypoint,
      ...(preview ? {
        observability: {
          enabled: true,
          logs: { enabled: true, headSamplingRate: 1 },
        },
      } : {}),
      assets: {
        notFoundHandling: "single-page-application",
        // The frontend is served publicly from assets; API requests run through the Worker.
        runWorkerFirst: ["/api/*"],
      },
      env: {
        DB: bindings.d1({
          name: preview ? "tayori-preview-db" : "tayori-db",
          id: (preview ? process.env.TAYORI_PREVIEW_D1_DATABASE_ID : process.env.TAYORI_D1_DATABASE_ID)
            ?? "00000000-0000-4000-8000-000000000001",
        }),
        JOBS: bindings.queue<QueueMessage>({ name: queueName }),
        ACCESS_TEAM_DOMAIN: bindings.secret(),
        ACCESS_AUD: bindings.secret(),
        ALLOWED_EMAIL: bindings.secret(),
      },
    },
  };
});
