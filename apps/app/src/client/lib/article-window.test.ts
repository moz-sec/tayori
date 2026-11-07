import { describe, expect, it, vi } from "vitest";
import { loadArticleWindow } from "./article-window";
describe("background article window", () => {
  it("retains a 125-article window and the next cursor with bounded page requests", async () => {
    const load = vi.fn(async (limit: number, cursor = "0") => {
      const start = Number(cursor);
      return {
        data: Array.from({ length: limit }, (_, i) => start + i),
        nextCursor: String(start + limit),
      };
    });
    const result = await loadArticleWindow(125, load);
    expect(load.mock.calls).toEqual([
      [50, undefined],
      [50, "50"],
      [25, "100"],
    ]);
    expect(result.data).toEqual(Array.from({ length: 125 }, (_, i) => i));
    expect(result.nextCursor).toBe("125");
  });
  it("stops when deletions or filtering shrink the result", async () => {
    const load = vi.fn(async () => ({ data: ["remaining"], nextCursor: null }));
    expect(await loadArticleWindow(100, load)).toEqual({ data: ["remaining"], nextCursor: null });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("propagates a later page failure so the current visible list can be retained", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 50 }, (_, i) => i), nextCursor: "next" })
      .mockRejectedValueOnce(new Error("offline"));
    await expect(loadArticleWindow(100, load)).rejects.toThrow("offline");
  });
});
