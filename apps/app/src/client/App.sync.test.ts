// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Article, Folder } from "./types";

let container: HTMLDivElement;
let root: Root;
let queries: URL[];
let revision: string;
let folderRows: Folder[];
let deferArticles: ((url: URL) => Promise<Response> | undefined) | undefined;
function article(id: string): Article {
  return { id, sourceId: "feed", sourceTitle: "Feed", title: `${revision}記事${id}`, url: `https://example.com/${id}`, author: null, summary: null, publishedAt: null, expiresAt: "2026-12-01T00:00:00Z", read: false, starred: false, readLater: false, saved: false, version: 1 };
}
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queries = []; revision = ""; deferArticles = undefined; folderRows = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    const url = new URL(path, "http://localhost");
    if (url.pathname.endsWith("/folders")) return Response.json({ data: folderRows });
    if (url.pathname.endsWith("/sources")) return Response.json({ data: [{ id: "feed", folderId: null, title: "Feed", url: "https://example.com/feed", status: "active", lastCheckedAt: null, nextFetchAt: "2026-11-01T12:00:00Z", unreadCount: 0, lastSuccessAt: null, errorCode: null, consecutiveFailures: 0 }] });
    if (url.pathname.endsWith("/me")) return Response.json({ data: { retentionDays: 7 } });
    if (url.pathname.endsWith("/status")) return Response.json({ data: { activeSources: 1, failingSources: 0, lastTickAt: null } });
    if (url.pathname.endsWith("/articles")) {
      queries.push(url);
      const deferred = deferArticles?.(url);
      if (deferred) return deferred;
      if (url.searchParams.get("scope") === "unread") return Response.json({ data: [article("未読")], nextCursor: null });
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const end = Math.min(150, start + Number(url.searchParams.get("limit")));
      return Response.json({ data: Array.from({ length: end - start }, (_, i) => article(String(start + i))), nextCursor: end < 150 ? String(end) : null });
    }
    throw new Error(`Unexpected request ${path}`);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("App foreground synchronization", () => {
  it("refreshes a paged window and preserves selected IDs while coalescing return events", async () => {
    await act(async () => root.render(createElement(App)));
    await click("さらに読み込む");
    expect(container.querySelectorAll("article")).toHaveLength(100);
    await act(async () => { (container.querySelector('[aria-label="「記事99」を選択"]') as HTMLInputElement).click(); });
    revision = "更新後";
    queries = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(container.querySelectorAll("article")).toHaveLength(100);
    expect(container.textContent).toContain("更新後記事99");
    expect((container.querySelector('[aria-label="「更新後記事99」を選択"]') as HTMLInputElement).checked).toBe(true);
  });
  it("ignores an old background response after changing the filter", async () => {
    await act(async () => root.render(createElement(App)));
    let finish!: (response: Response) => void;
    deferArticles = (url) => url.searchParams.get("scope") === "all" ? new Promise((resolve) => { finish = resolve; }) : undefined;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      window.dispatchEvent(new Event("focus"));
    });
    await click("未読");
    expect(container.querySelector("h1")?.textContent).toBe("未読");
    await act(async () => finish(Response.json({ data: [article("古い応答")], nextCursor: null })));
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.textContent).toContain("記事未読");
    expect(container.textContent).not.toContain("古い応答");
  });
  it("discards a background response overlapping a write and defers return sync until completion", async () => {
    const fetchMock = vi.mocked(fetch);
    const baseFetch = fetchMock.getMockImplementation()!;
    let finishWrite!: (response: Response) => void;
    fetchMock.mockImplementation((...args) => {
      if (args[1]?.method === "PATCH") return new Promise((resolve) => { finishWrite = resolve; });
      return baseFetch(...args);
    });
    await act(async () => root.render(createElement(App)));
    let finishRead!: (response: Response) => void;
    deferArticles = () => new Promise((resolve) => { finishRead = resolve; });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); window.dispatchEvent(new Event("focus")); });
    await click("既読にする");
    await act(async () => finishRead(Response.json({ data: [article("古い応答")], nextCursor: null })));
    expect(container.textContent).not.toContain("古い応答");
    const before = queries.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(2_000); });
    expect(queries).toHaveLength(before);
    deferArticles = undefined; revision = "保存後";
    await act(async () => finishWrite(Response.json({ data: {} })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(container.textContent).toContain("保存後記事0");
    expect(container.textContent).not.toContain("古い応答");
  });
  it("defers synchronization while a settings form is open, then runs after closing it", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => { (container.querySelector('[aria-label="New folder"]') as HTMLButtonElement).click(); });
    const before = queries.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(2_000); });
    expect(queries).toHaveLength(before);
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    await click("Cancel");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(queries.length).toBeGreaterThan(before);
  });
  it("returns to all articles if another device removes the selected folder", async () => {
    folderRows = [{ id: "removed", parentId: null, name: "Removed", sortOrder: 0, unreadCount: 0 }];
    await act(async () => root.render(createElement(App)));
    const select = [...container.querySelectorAll("button")].find((button) => button.textContent === "Removed")!;
    await act(async () => select.click());
    expect(container.querySelector("h1")?.textContent).toBe("Removed");
    folderRows = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); window.dispatchEvent(new Event("focus")); });
    expect(container.querySelector("h1")?.textContent).toBe("すべての記事");
    expect(queries.at(-1)?.searchParams.has("folderId")).toBe(false);
  });

  it.each([null, "parent"])("moves the selected view to its parent %s after folder deletion", async (parentId) => {
    folderRows = [
      { id: "parent", parentId: null, name: "Parent", sortOrder: 0, unreadCount: 0 },
      { id: "removed", parentId, name: "Removed", sortOrder: 1, unreadCount: 0 },
    ];
    const fetchMock = vi.mocked(fetch);
    const baseFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((...args) => {
      if (String(args[0]).endsWith("/folders/removed") && args[1]?.method === "DELETE") {
        folderRows = folderRows.filter((folder) => folder.id !== "removed");
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return baseFetch(...args);
    });
    await act(async () => root.render(createElement(App)));
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Removed")!.click(); });
    await act(async () => { (container.querySelector('[aria-label="Settings for Removed"]') as HTMLButtonElement).click(); });
    await click("フォルダを削除");
    await click("確認して削除");
    expect(container.querySelector("h1")?.textContent).toBe(parentId ? "Parent" : "すべての記事");
    expect(queries.at(-1)?.searchParams.get("folderId")).toBe(parentId);
    expect(container.querySelector('[aria-label="Settings for Removed"]')).toBeNull();
  });

  it.each([[false, false], [true, false], [false, true]])("reloads after a failed folder move and retains its error (reload fails: %s, selected folder: %s)", async (reloadFails, selectedFolder) => {
    folderRows = [
      { id: "removed", parentId: null, name: "Removed", sortOrder: 0, unreadCount: 0 },
      { id: "kept", parentId: null, name: "Kept", sortOrder: 1, unreadCount: 0 },
    ];
    const fetchMock = vi.mocked(fetch);
    const baseFetch = fetchMock.getMockImplementation()!;
    let moveFailed = false;
    let folderReloads = 0;
    fetchMock.mockImplementation((...args) => {
      const path = String(args[0]);
      if (path.endsWith("/folders/removed/move")) {
        moveFailed = true;
        folderRows = folderRows.filter((folder) => folder.id !== "removed");
        return Promise.resolve(Response.json({ error: { code: "FOLDER_NOT_FOUND" } }, { status: 404 }));
      }
      if (moveFailed && path.endsWith("/folders")) {
        folderReloads++;
        if (reloadFails) return Promise.resolve(Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 }));
      }
      return baseFetch(...args);
    });
    await act(async () => root.render(createElement(App)));
    if (selectedFolder) await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Removed")!.click(); });
    await act(async () => { (container.querySelector('[aria-label="Removedを下へ移動"]') as HTMLButtonElement).click(); });
    expect(folderReloads).toBe(selectedFolder ? 2 : 1);
    expect(container.querySelector('[aria-label="Settings for Removed"]') === null).toBe(!reloadFails);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("FOLDER_NOT_FOUND");
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain("INTERNAL_ERROR");
    expect((container.querySelector('[aria-label="Keptを上へ移動"]') as HTMLButtonElement).disabled).toBe(!reloadFails);
  });

});
