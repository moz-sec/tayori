import { afterEach, expect, it, vi } from "vitest";
import config from "../cloudflare.config";

afterEach(() => vi.unstubAllEnvs());

it("places monitoring bindings in worker env only when enabled", () => {
  vi.stubEnv("TAYORI_MONITORING_ENABLED", "false");
  const disabled = config({ mode: "production", isPreview: false });
  for (const name of [
    "MONITOR_WEBHOOK_URL",
    "MONITOR_TICK_STALE_SECONDS",
    "MONITOR_BACKLOG_STALE_SECONDS",
    "MONITOR_FAILURE_THRESHOLD",
  ]) {
    expect(disabled.worker.env).not.toHaveProperty(name);
  }
  vi.stubEnv("TAYORI_MONITORING_ENABLED", "true");
  vi.stubEnv("MONITOR_FAILURE_THRESHOLD", "7");
  const enabled = config({ mode: "production", isPreview: false });
  expect(enabled.worker.env).toHaveProperty("MONITOR_WEBHOOK_URL");
  expect(enabled.worker.env).toHaveProperty("MONITOR_TICK_STALE_SECONDS");
  expect(enabled.worker.env).toHaveProperty("MONITOR_BACKLOG_STALE_SECONDS");
  expect(enabled.worker.env.MONITOR_FAILURE_THRESHOLD).toEqual(
    expect.objectContaining({ value: "7" }),
  );
  expect(enabled.worker.observability).not.toHaveProperty("MONITOR_WEBHOOK_URL");
});
