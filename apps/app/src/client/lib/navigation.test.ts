import { describe, expect, it } from "vitest";
import { ALL_ARTICLES, isPlainNavigation, navigationHref, navigationKey, readNavigation, validateNavigation } from "./navigation";

describe("reader URL navigation", () => {
  it("restores each supported scope and round-trips folder/feed identifiers", () => {
    for (const scope of ["all", "unread", "read-later", "starred"] as const) {
      const view = { ...ALL_ARTICLES, scope };
      expect(readNavigation(navigationHref(view))).toEqual(view);
    }
    for (const key of ["folderId", "sourceId"] as const) {
      const view = { ...ALL_ARTICLES, [key]: "feed:abc_123-xyz" };
      expect(readNavigation(navigationHref(view))).toEqual(view);
    }
  });

  it("uses one unambiguous selection when parameters conflict or repeat", () => {
    const view = readNavigation("/?scope=starred&folderId=folder&sourceId=feed&sourceId=other");
    expect(view).toEqual({ scope: "all", folderId: null, sourceId: "feed" });
    expect(navigationHref(view)).toBe("/?sourceId=feed");
    expect(readNavigation("/?scope=unread&folderId=folder")).toEqual({ scope: "all", folderId: "folder", sourceId: null });
  });

  it("rejects invalid scopes and IDs before constructing article API requests", () => {
    expect(readNavigation("/?scope=unsupported&sourceId=%3Cscript%3E&folderId=%2Fetc")).toEqual(ALL_ARTICLES);
    expect(readNavigation(`/?sourceId=${"a".repeat(101)}`)).toEqual(ALL_ARTICLES);
    expect(readNavigation("/?sourceId=&folderId=&scope=")).toEqual(ALL_ARTICLES);
    expect(readNavigation("/?sourceId=%3Cbad%3E&scope=unread")).toEqual({ ...ALL_ARTICLES, scope: "unread" });
  });

  it("clears stale pagination/view parameters without dropping unrelated URL state", () => {
    expect(navigationHref({ ...ALL_ARTICLES, scope: "unread" }, "/reader?sourceId=old&cursor=page-2&scope=all&scope=starred&keep=yes#article"))
      .toBe("/reader?keep=yes&scope=unread#article");
    expect(navigationHref(ALL_ARTICLES, "/?scope=all")).toBe("/");
  });

  it("falls back for missing folders and archived feeds while retaining paused feeds", () => {
    const folders = [{ id: "folder" }];
    const sources = [{ id: "paused", status: "paused" as const }, { id: "archived", status: "archived" as const }];
    const folder = { ...ALL_ARTICLES, folderId: "folder" };
    expect(validateNavigation(folder, folders, sources)).toEqual(folder);
    expect(validateNavigation({ ...ALL_ARTICLES, folderId: "deleted" }, folders, sources)).toEqual(ALL_ARTICLES);
    expect(validateNavigation({ ...ALL_ARTICLES, sourceId: "missing" }, folders, sources)).toEqual(ALL_ARTICLES);
    expect(validateNavigation({ ...ALL_ARTICLES, sourceId: "archived" }, folders, sources)).toEqual(ALL_ARTICLES);
    const paused = { ...ALL_ARTICLES, sourceId: "paused" };
    expect(validateNavigation(paused, folders, sources)).toEqual(paused);
  });

  it("does not conflate IDs containing the old view-key separator", () => {
    expect(navigationKey({ ...ALL_ARTICLES, folderId: "a:b" }))
      .not.toBe(navigationKey({ ...ALL_ARTICLES, folderId: "a", sourceId: "b:" }));
  });

  it("intercepts only plain primary-button activation", () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    expect(isPlainNavigation(plain)).toBe(true);
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey", "defaultPrevented"] as const) {
      expect(isPlainNavigation({ ...plain, [key]: true })).toBe(false);
    }
    expect(isPlainNavigation({ ...plain, button: 1 })).toBe(false);
    expect(isPlainNavigation({ ...plain, button: 2 })).toBe(false);
  });
});
