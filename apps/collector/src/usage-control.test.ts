import { afterEach, expect, it, vi } from "vitest";
import { sqliteD1 } from "./test/sqlite-d1";
import { loadUsageControl, refreshUsageControl } from "./usage-control";

const seconds = Date.parse("2026-11-07T12:00:00Z") / 1000;
const options = {
  D1_USAGE_ENABLED: "true",
  D1_ACCOUNT_ID: "a",
  D1_DATABASE_ID: "b",
  D1_ANALYTICS_TOKEN: "token",
  D1_STORAGE_LIMIT_BYTES: "100",
  D1_ROWS_READ_LIMIT: "100",
  D1_ROWS_WRITTEN_LIMIT: "100",
  D1_WARNING_RATIO: "0.8",
  D1_MAX_AGE_SECONDS: "3600",
};
afterEach(() => vi.unstubAllGlobals());
it("enables monitoring after disabled and stops on stale data after a refresh failure", async () => {
  const db = sqliteD1();
  expect((await loadUsageControl(db.binding, seconds)).state).toBe("disabled");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(input).includes("/graphql")
              ? {
                  data: {
                    viewer: {
                      accounts: [
                        { d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 1, rowsWritten: 1 } }] },
                      ],
                    },
                  },
                }
              : { success: true, result: { file_size: 1 } },
          ),
        ),
    ),
  );
  await refreshUsageControl({ DB: db.binding, ...options }, seconds);
  expect((await loadUsageControl(db.binding, seconds)).state).toBe("ok");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await refreshUsageControl({ DB: db.binding, ...options }, seconds + 3601);
  expect((await loadUsageControl(db.binding, seconds + 3601)).reason).toBe("unavailable");
});
it("fails closed when enabled settings or credentials are invalid", async () => {
  const db = sqliteD1();
  await refreshUsageControl({ DB: db.binding, ...options, D1_ANALYTICS_TOKEN: undefined }, seconds);
  expect((await loadUsageControl(db.binding, seconds)).state).toBe("stopped");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await refreshUsageControl({ DB: db.binding, ...options, D1_ROWS_READ_LIMIT: "bad" }, seconds);
  expect((await loadUsageControl(db.binding, seconds)).state).toBe("stopped");
});

it("logs only a fixed error category when the request fails", async () => {
  const db = sqliteD1();
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  await refreshUsageControl({ DB: db.binding, ...options }, seconds);
  expect(logger).toHaveBeenCalledWith(
    JSON.stringify({ event: "D1_USAGE_REFRESH_FAILED", code: "http_error" }),
  );
  logger.mockRestore();
});
