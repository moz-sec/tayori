import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** Test-only entrypoint and ephemeral bindings; never uses the developer's local D1. */
export default defineConfig({
  plugins: [cloudflare({
    config: {
      entrypoint: fileURLToPath(new URL("./e2e/worker.ts", import.meta.url)),
      assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/__e2e/*"] },
    },
    persistState: false,
    remoteBindings: false,
    inspectorPort: false,
    types: { generate: false },
  }), tailwindcss()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
