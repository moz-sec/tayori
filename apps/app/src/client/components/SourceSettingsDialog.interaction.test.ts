// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { SourceSettingsDialog } from "./SourceSettingsDialog";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/api-client")>(),
  request,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onClose = vi.fn();
const onCommitted = vi.fn(async () => {});
async function mount() {
  await act(async () => root.render(createElement(SourceSettingsDialog, {
    source: { id: "feed", folderId: null, title: "Old", url: "https://example.com/feed", status: "active", lastCheckedAt: null, nextFetchAt: "2026-11-01T12:00:00Z", unreadCount: 0, lastSuccessAt: null, errorCode: null, consecutiveFailures: 0 },
    folders: [{ id: "folder", parentId: null, name: "Folder", sortOrder: 0, unreadCount: 0 }], onClose, onCommitted,
  })));
}
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  request.mockReset(); onClose.mockClear(); onCommitted.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("subscription settings interactions", () => {
  it("retains edited values after failure and retries the same save", async () => {
    request.mockRejectedValueOnce(new Error("NOT_FOUND")).mockResolvedValueOnce({});
    await mount();
    const title = container.querySelector('input[name="title"]')! as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "New");
      title.dispatchEvent(new Event("input", { bubbles: true }));
      const select = container.querySelector("select")!;
      select.value = "folder"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(request).toHaveBeenLastCalledWith("/sources/feed", { method: "PATCH", body: JSON.stringify({ title: "New", folderId: "folder" }) });
    expect(title.value).toBe("New"); expect(container.querySelector("select")!.value).toBe("folder");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("NOT_FOUND"); expect(onClose).not.toHaveBeenCalled();
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(request).toHaveBeenCalledTimes(2); expect(onCommitted).toHaveBeenCalledWith("feed", false); expect(onClose).toHaveBeenCalledOnce();
  });
  it("requires explicit archive confirmation, keeps it after failure, and prevents duplicate requests", async () => {
    let reject: (error: Error) => void = () => {};
    request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce(undefined);
    await mount();
    await act(async () => button("購読解除…").click());
    expect(button("確認して購読解除").disabled).toBe(true); expect(request).not.toHaveBeenCalled();
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => { button("確認して購読解除").click(); button("確認して購読解除").click(); });
    expect(request).toHaveBeenCalledTimes(1); expect(request).toHaveBeenLastCalledWith("/sources/feed", { method: "DELETE" });
    expect(button("閉じる").disabled).toBe(true);
    await act(async () => reject(new Error("INTERNAL_ERROR")));
    expect(onClose).not.toHaveBeenCalled(); expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    await act(async () => button("確認して購読解除").click());
    expect(onCommitted).toHaveBeenCalledWith("feed", true); expect(onClose).toHaveBeenCalledOnce();
  });
});

it("clears the archived source selection and reloads the current global article list", async () => {
  const { App } = await import("../App");
  let archived = false;
  const articleQueries: string[] = [];
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/sources/feed" && init?.method === "DELETE") { archived = true; return undefined; }
    if (path === "/folders") return { data: [] };
    if (path === "/sources") return { data: [{ id: "feed", folderId: null, title: "Old", url: "https://example.com/feed", status: archived ? "archived" : "active", lastCheckedAt: null, nextFetchAt: "2026-11-01T12:00:00Z", unreadCount: 0, lastSuccessAt: null, errorCode: null, consecutiveFailures: 0 }] };
    if (path === "/me") return { data: { retentionDays: 7 } };
    if (path === "/status") return { data: { activeSources: archived ? 0 : 1, failingSources: 0, lastTickAt: null } };
    if (path.startsWith("/articles?")) { articleQueries.push(path); return { data: [], nextCursor: null }; }
    throw new Error("Unexpected " + path);
  });
  await act(async () => root.render(createElement(App)));
  await act(async () => (container.querySelector('button[title="Old"]') as HTMLButtonElement).click());
  expect(container.querySelector("h1")!.textContent).toBe("Old");
  await act(async () => (container.querySelector('[aria-label="Oldの購読設定"]') as HTMLButtonElement).click());
  await act(async () => button("購読解除…").click());
  await act(async () => (container.querySelector('.modal input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => button("確認して購読解除").click());
  expect(container.querySelector("h1")!.textContent).toBe("すべての記事");
  expect(container.querySelector('[aria-label="Oldの購読設定"]')).toBeNull();
  expect(articleQueries.at(-1)).not.toContain("sourceId=");
});
