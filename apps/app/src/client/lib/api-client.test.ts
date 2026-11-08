import { afterEach, describe, expect, it, vi } from "vitest";
import { getMutationState, request } from "./api-client";
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("pending write tracking", () => {
  it("tracks writes through response completion while ordinary reads leave the version unchanged", async () => {
    vi.stubGlobal("location", { origin: "http://localhost" });
    const initial = getMutationState();
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const write = request("/articles/a", { method: "PATCH", body: "{}" });
    expect(getMutationState()).toEqual({ pending: 1, version: initial.version + 1 });
    finish(new Response(null, { status: 204 }));
    await write;
    expect(getMutationState().pending).toBe(0);
    const read = request("/sources");
    expect(getMutationState().version).toBe(initial.version + 1);
    finish(Response.json({ data: [] }));
    await read;
  });
  it("releases the pending write after network failure", async () => {
    vi.stubGlobal("location", { origin: "http://localhost" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(request("/sources/a", { method: "DELETE" })).rejects.toThrow("offline");
    expect(getMutationState().pending).toBe(0);
  });
});
