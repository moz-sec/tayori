import { afterEach, describe, expect, it, vi } from "vitest";
import { markArticlesRead } from "./mark-read";

const articleIds = (count: number) => Array.from({ length: count }, (_, index) => `article-${index}`);
const successfulBatch = async (ids: string[]) => ({ data: { updated: ids.length } });

afterEach(() => { vi.unstubAllGlobals(); });

describe("markArticlesRead", () => {
  it.each([1, 49, 50])("sends all %i IDs in one request", async (count) => {
    const ids = articleIds(count);
    const send = vi.fn(successfulBatch);
    expect(await markArticlesRead(ids, send)).toEqual({ completed: count, updated: count, remainingIds: [] });
    expect(send.mock.calls).toEqual([[ids]]);
  });

  it("splits more than 100 IDs into requests of at most 50", async () => {
    const ids = articleIds(123);
    const send = vi.fn(successfulBatch);
    expect(await markArticlesRead(ids, send)).toEqual({ completed: 123, updated: 123, remainingIds: [] });
    expect(send.mock.calls).toEqual([[ids.slice(0, 50)], [ids.slice(50, 100)], [ids.slice(100)]]);
  });

  it("retains a failed batch and all later IDs, and retries only those IDs", async () => {
    const ids = articleIds(123);
    const failure = new Error("NETWORK_ERROR");
    const send = vi.fn(successfulBatch).mockImplementationOnce(successfulBatch).mockRejectedValueOnce(failure);
    const failed = await markArticlesRead(ids, send);
    expect(failed).toEqual({ completed: 50, updated: 50, remainingIds: ids.slice(50), error: failure });
    expect(send).toHaveBeenCalledTimes(2);

    const retry = vi.fn(successfulBatch);
    expect(await markArticlesRead(failed.remainingIds, retry)).toEqual({ completed: 73, updated: 73, remainingIds: [] });
    expect(retry.mock.calls).toEqual([[ids.slice(50, 100)], [ids.slice(100)]]);
  });

  it("preserves every ID when the first request fails", async () => {
    const ids = articleIds(100);
    const failure = new Error("NETWORK_ERROR");
    expect(await markArticlesRead(ids, async () => { throw failure; })).toEqual({ completed: 0, updated: 0, remainingIds: ids, error: failure });
  });

  it("keeps the original snapshot when the displayed IDs change while sending", async () => {
    const ids = articleIds(101);
    const original = [...ids];
    const send = vi.fn(async (batch: string[]) => {
      ids.splice(0, ids.length, "new-article");
      return successfulBatch(batch);
    });
    await markArticlesRead(ids, send);
    expect(send.mock.calls.flatMap(([batch]) => batch)).toEqual(original);
  });

  it("deduplicates IDs and skips an empty list", async () => {
    const send = vi.fn(successfulBatch);
    expect(await markArticlesRead([], send)).toEqual({ completed: 0, updated: 0, remainingIds: [] });
    expect(send).not.toHaveBeenCalled();
    expect(await markArticlesRead(["a", "a", "b"], send)).toEqual({ completed: 2, updated: 2, remainingIds: [] });
    expect(send.mock.calls).toEqual([[["a", "b"]]]);
  });

  it("reports the updated count separately when articles were deleted", async () => {
    const send = vi.fn().mockResolvedValue({ data: { updated: 48 } });
    expect(await markArticlesRead(articleIds(50), send)).toEqual({ completed: 50, updated: 48, remainingIds: [] });
  });

  it("sends the read flag to the bulk endpoint with authenticated request headers", async () => {
    vi.stubGlobal("location", { origin: "https://tayori.example" });
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { updated: 2, requested: 2 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await markArticlesRead(["a", "b"])).toEqual({ completed: 2, updated: 2, remainingIds: [] });
    expect(fetch).toHaveBeenCalledWith("/api/v1/articles/read", expect.objectContaining({
      method: "POST", body: JSON.stringify({ articleIds: ["a", "b"], read: true }), credentials: "same-origin",
    }));
    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Origin")).toBe("https://tayori.example");
  });
});
