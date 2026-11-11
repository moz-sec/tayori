import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenFolders, readExpandedFolders, saveExpandedFolders } from "./folder-tree";
import type { Folder } from "../types";
const folders: Folder[] = [
  { id: "b", name: "B", parentId: null, sortOrder: 0, unreadCount: 0 },
  { id: "a", name: "A", parentId: null, sortOrder: 1, unreadCount: 0 },
  { id: "x", name: "X", parentId: "a", sortOrder: 0, unreadCount: 0 },
  { id: "y", name: "Y", parentId: "x", sortOrder: 0, unreadCount: 0 },
];
afterEach(() => vi.unstubAllGlobals());
describe("folder visibility and browser preferences", () => {
  it("retains API sibling ordering and hides descendants only under collapsed parents", () => {
    expect(flattenFolders(folders).map((folder) => [folder.id, folder.depth])).toEqual([
      ["b", 0],
      ["a", 0],
      ["x", 1],
      ["y", 2],
    ]);
    expect(flattenFolders(folders, new Set(["a"])).map((folder) => folder.id)).toEqual(["b", "a"]);
    expect(flattenFolders(folders, new Set(["x"])).map((folder) => folder.id)).toEqual([
      "b",
      "a",
      "x",
    ]);
    expect(flattenFolders(folders).map((folder) => folder.id)).toEqual(["b", "a", "x", "y"]);
  });
  it("restores expanded IDs on remount and safely ignores malformed or denied storage", () => {
    let stored = "";
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      },
    });
    expect(readExpandedFolders()).toEqual(new Set());
    saveExpandedFolders(new Set(["a", "x"]));
    expect(readExpandedFolders()).toEqual(new Set(["a", "x"]));
    stored = '["a",7,null]';
    expect(readExpandedFolders()).toEqual(new Set(["a"]));
    stored = "{broken";
    expect(readExpandedFolders()).toEqual(new Set());
    stored = "{}";
    expect(readExpandedFolders()).toEqual(new Set());
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("denied");
      },
    });
    expect(readExpandedFolders()).toEqual(new Set());
    expect(() => saveExpandedFolders(new Set(["a"]))).not.toThrow();
  });
});
