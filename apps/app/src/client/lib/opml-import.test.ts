import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api-client";
import { importOpmlRows, summarizeImport, type ImportRow } from "./opml-import";
import type { Folder } from "../types";

vi.mock("./api-client", () => ({ request: vi.fn() }));
const mockRequest = vi.mocked(request);
const entries = (count: number): ImportRow[] =>
  Array.from({ length: count }, (_, index) => ({
    outline: { title: `Feed ${index}`, url: `https://example.com/feed/${index}`, folderPath: [] },
    status: "pending",
  }));

beforeEach(() => {
  mockRequest.mockReset();
});

describe("OPML import results", () => {
  it("distinguishes added, existing and row errors and retries only failed feeds", async () => {
    mockRequest.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
      data: [
        { status: "added" },
        { status: "existing" },
        { status: "error", code: "INVALID_FEED_URL" },
      ],
    });
    const progress = vi.fn();
    const first = await importOpmlRows(entries(3), progress);
    expect(summarizeImport(first.rows)).toBe("追加 1 件、登録済み 1 件、失敗 1 件、未処理 0 件");
    expect(first.rows[2].error).toContain("公開されているHTTP/HTTPS");
    expect(first.rows[2].outline.url).toBe("https://example.com/feed/2");
    expect(progress).toHaveBeenCalledOnce();

    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ status: "added" }] });
    const retry = await importOpmlRows(first.rows, vi.fn());
    expect(JSON.parse(String(mockRequest.mock.calls[3][1]?.body)).sources).toHaveLength(1);
    expect(JSON.parse(String(mockRequest.mock.calls[3][1]?.body)).sources[0].url).toBe(
      first.rows[2].outline.url,
    );
    expect(summarizeImport(retry.rows)).toBe("追加 2 件、登録済み 1 件、失敗 0 件、未処理 0 件");
    expect(first.rows[2].status).toBe("error");
  });

  it("retains confirmed results and unprocessed feeds after a middle batch fails", async () => {
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: Array.from({ length: 5 }, () => ({ status: "added" })) })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = await importOpmlRows(entries(12), vi.fn());
    expect(first.interrupted).toContain("中断");
    expect(summarizeImport(first.rows)).toBe("追加 5 件、登録済み 0 件、失敗 5 件、未処理 2 件");
    expect(first.rows[5].error).toContain("結果を確認できませんでした");
    expect(first.rows[10].status).toBe("pending");
    expect(mockRequest).toHaveBeenCalledTimes(3);

    // The failed response may have been lost after the server committed its batch.
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: Array.from({ length: 5 }, () => ({ status: "existing" })) })
      .mockResolvedValueOnce({ data: [{ status: "added" }, { status: "added" }] });
    const retry = await importOpmlRows(first.rows, vi.fn());
    expect(summarizeImport(retry.rows)).toBe("追加 7 件、登録済み 5 件、失敗 0 件、未処理 0 件");
    const retriedUrls = mockRequest.mock.calls
      .slice(4)
      .flatMap(([, init]) =>
        JSON.parse(String(init?.body)).sources.map((source: { url: string }) => source.url),
      );
    expect(retriedUrls).toHaveLength(7);
    expect(retriedUrls).not.toContain(first.rows[0].outline.url);
  });

  it("reuses folders after a folder creation response is lost", async () => {
    const rows = entries(2).map((row) => ({
      ...row,
      outline: { ...row.outline, folderPath: ["News", "Tech"] },
    }));
    const folders: Folder[] = [];
    let lostResponse = true;
    const urls = new Set<string>();
    mockRequest.mockImplementation(async (path, init) => {
      if (path === "/folders" && !init) return { data: [...folders] };
      if (path === "/folders") {
        const values = JSON.parse(String(init?.body));
        const id = String(folders.length + 1);
        folders.push({ ...values, id, sortOrder: 0, unreadCount: 0 });
        if (lostResponse) {
          lostResponse = false;
          throw new TypeError("Failed to fetch");
        }
        return { data: { id } };
      }
      const sources = JSON.parse(String(init?.body)).sources as { url: string; folderId: string }[];
      return {
        data: sources.map((source) => {
          expect(source.folderId).toBe("2");
          const status = urls.has(source.url) ? "existing" : "added";
          urls.add(source.url);
          return { status };
        }),
      };
    });
    const first = await importOpmlRows(rows, vi.fn());
    expect(first.interrupted).toContain("フォルダ");
    expect(first.rows.every((row) => row.status === "pending")).toBe(true);
    const retry = await importOpmlRows(first.rows, vi.fn());
    expect(folders.map((folder) => folder.name)).toEqual(["News", "Tech"]);
    expect(urls.size).toBe(2);
    expect(retry.rows.every((row) => row.status === "added")).toBe(true);
  });

  it("keeps a malformed batch response retryable instead of reporting success", async () => {
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ status: "added" }] });
    const result = await importOpmlRows(entries(2), vi.fn());
    expect(result.rows.every((row) => row.status === "error")).toBe(true);
    expect(result.interrupted).toBeDefined();
  });
});
