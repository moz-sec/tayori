import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockDatabase(options: { listError?: Error; insertError?: Error } = {}): D1Database {
  return {
    prepare: vi.fn((sql: string) => {
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn(async () => {
          if (options.listError) throw options.listError;
          return { results: [] };
        }),
        first: vi.fn(async () => null),
        run: vi.fn(async () => {
          if (options.insertError) throw options.insertError;
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

describe("source API database errors", () => {
  it("returns an internal error when listing sources fails", async () => {
    const db = mockDatabase({ listError: new Error("no such table: sources") });
    const response = await api.request("http://localhost/api/v1/sources", {}, { DB: db } as Env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("returns conflict only for the normalized URL unique constraint", async () => {
    const db = mockDatabase({
      insertError: new Error("D1_ERROR: UNIQUE constraint failed: sources.normalized_url: SQLITE_CONSTRAINT"),
    });
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db } as Env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SOURCE_ALREADY_EXISTS" } });
  });

  it("preserves unrelated database failures as internal errors", async () => {
    const db = mockDatabase({ insertError: new Error("no such table: sources") });
    const response = await api.request("http://localhost/api/v1/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    }, { DB: db } as Env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});

describe("article reads", () => {
  it("returns stored articles without contacting external feeds", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Feed server unavailable"));
    try {
      const response = await api.request("http://localhost/api/v1/articles", {}, { DB: mockDatabase() } as Env);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [], nextCursor: null });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});
