import { describe, expect, it } from "vitest";
import { evaluateD1Usage, fetchD1Usage } from "../../../packages/shared/src/d1-usage";

const now = new Date("2026-11-07T12:00:00Z");
const limits = {
  storageBytes: 100,
  rowsRead: 100,
  rowsWritten: 100,
  warningRatio: 0.8,
  maxAgeSeconds: 3600,
};
const snapshot = {
  observedAt: now.toISOString(),
  dayUtc: "2026-11-07",
  storageBytes: 10,
  rowsRead: 10,
  rowsWritten: 10,
};

describe("D1 usage", () => {
  it("warns and stops at thresholds, and resumes after recovery", () => {
    expect(evaluateD1Usage({ ...snapshot, rowsRead: 80 }, limits, now).state).toBe("warning");
    expect(evaluateD1Usage({ ...snapshot, rowsRead: 100 }, limits, now).state).toBe("stopped");
    expect(evaluateD1Usage(snapshot, limits, now).state).toBe("ok");
  });
  it("stops for missing, stale, or previous UTC day data", () => {
    expect(evaluateD1Usage(null, limits, now).reason).toBe("unavailable");
    expect(
      evaluateD1Usage({ ...snapshot, observedAt: "2026-11-07T10:59:59Z" }, limits, now).state,
    ).toBe("stopped");
    expect(
      evaluateD1Usage(
        { ...snapshot, observedAt: "2026-11-06T23:59:59Z", dayUtc: "2026-11-06" },
        limits,
        new Date("2026-11-07T00:00:00Z"),
      ).state,
    ).toBe("stopped");
  });
  it("aggregates account rows and fails closed on incomplete results", async () => {
    const credentials = { accountId: "a", databaseId: "b", apiToken: "token" };
    const response = (body: unknown) => async (input: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(input).includes("/graphql") ? body : { success: true, result: { file_size: 7 } },
        ),
      );
    const data = {
      data: {
        viewer: {
          accounts: [
            {
              d1AnalyticsAdaptiveGroups: [
                { sum: { rowsRead: 3, rowsWritten: 4 } },
                { sum: { rowsRead: 5, rowsWritten: 6 } },
              ],
              d1StorageAdaptiveGroups: [{ max: { databaseSizeBytes: 7 } }],
            },
          ],
        },
      },
    };
    expect(await fetchD1Usage(credentials, now, response(data))).toMatchObject({
      rowsRead: 8,
      rowsWritten: 10,
      storageBytes: 7,
    });
    await expect(
      fetchD1Usage(credentials, now, response({ errors: [{ message: "failed" }] })),
    ).rejects.toThrow();
  });
});

it("rejects empty analytics and HTTP failures", async () => {
  const credentials = { accountId: "a", databaseId: "b", apiToken: "token" };
  const empty = async (input: string | URL | Request) =>
    new Response(
      JSON.stringify(
        String(input).includes("/graphql")
          ? { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [] }] } } }
          : { success: true, result: { file_size: 7 } },
      ),
    );
  await expect(fetchD1Usage(credentials, now, empty)).rejects.toThrow();
  await expect(
    fetchD1Usage(credentials, now, async () => new Response(null, { status: 503 })),
  ).rejects.toThrow();
});
