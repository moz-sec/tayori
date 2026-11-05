// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createElement, act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SourceSettingsDialog } from "./SourceSettingsDialog";

type ApiClientModule = typeof import("../lib/api-client");

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/api-client", async (importOriginal) => ({
  ...await importOriginal<ApiClientModule>(),
  request,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let opener: HTMLButtonElement;
let fallback: HTMLButtonElement;
const onClose = vi.fn();
const onCommitted = vi.fn(async () => {});
const onFallbackFocus = vi.fn(() => fallback.focus());
async function mount(strict = false) {
  const dialog = createElement(SourceSettingsDialog, {
    source: { id: "feed", folderId: null, title: "Old", url: "https://example.com/feed", status: "active", lastCheckedAt: null, nextFetchAt: "2026-11-01T12:00:00Z", unreadCount: 0, lastSuccessAt: null, errorCode: null, consecutiveFailures: 0 },
    folders: [{ id: "folder", parentId: null, name: "Folder", sortOrder: 0, unreadCount: 0 }], onClose, onCommitted, onFallbackFocus,
  });
  await act(async () => root.render(strict ? createElement(StrictMode, null, dialog) : dialog));
}
const settleFocus = () => act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  request.mockReset(); onClose.mockReset(); onCommitted.mockReset().mockResolvedValue(undefined); onFallbackFocus.mockClear();
  opener = document.createElement("button"); opener.textContent = "購読設定を開く";
  fallback = document.createElement("button"); fallback.textContent = "更新";
  document.body.append(opener, fallback); opener.focus();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await settleFocus();
  container.remove();
  opener.remove(); fallback.remove();
  vi.unstubAllGlobals();
});

describe("subscription settings interactions", () => {
  it("moves a feed without fixing its unchanged automatic title", async () => {
    request.mockResolvedValueOnce({});
    await mount();
    const title = container.querySelector('input[name="title"]')! as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, " Old ");
      title.dispatchEvent(new Event("input", { bubbles: true }));
      const select = container.querySelector("select")!;
      select.value = "folder"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(request).toHaveBeenCalledWith("/sources/feed", { method: "PATCH", body: JSON.stringify({ folderId: "folder" }) });
  });
  it.each(["close button", "Escape"])("closes the native modal before notifying the parent and restores its opener with %s", async (exit) => {
    await mount(true);
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).not.toBe(opener);
    onClose.mockImplementation(() => { expect(dialog.open).toBe(false); });
    await act(async () => {
      if (exit === "close button") button("閉じる").click();
      else dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    await settleFocus();
    expect(document.activeElement).toBe(opener);
    expect(onFallbackFocus).not.toHaveBeenCalled();
  });

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
    expect(container.querySelector("dialog")!.open).toBe(true);
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(request).toHaveBeenCalledTimes(2); expect(onCommitted).toHaveBeenCalledWith("feed", false); expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")!.open).toBe(false);
    await settleFocus();
    expect(document.activeElement).toBe(opener);
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
    await act(async () => { container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(container.querySelector("dialog")!.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => reject(new Error("INTERNAL_ERROR")));
    expect(onClose).not.toHaveBeenCalled(); expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector("dialog")!.open).toBe(true);
    onCommitted.mockImplementationOnce(async () => { opener.remove(); });
    await act(async () => button("確認して購読解除").click());
    expect(onCommitted).toHaveBeenCalledWith("feed", true); expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")!.open).toBe(false);
    await settleFocus();
    expect(onFallbackFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(fallback);
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
  await act(async () => {
    const settings = container.querySelector('[aria-label="Oldの購読設定"]') as HTMLButtonElement;
    settings.focus(); settings.click();
  });
  await act(async () => button("購読解除…").click());
  await act(async () => (container.querySelector('.modal input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => button("確認して購読解除").click());
  expect(container.querySelector("h1")!.textContent).toBe("すべての記事");
  expect(container.querySelector('[aria-label="Oldの購読設定"]')).toBeNull();
  expect(articleQueries.at(-1)).not.toContain("sourceId=");
  await settleFocus();
  expect(document.activeElement).toBe(container.querySelector('[aria-label="更新"]'));
});
