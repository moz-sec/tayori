import type { Folder } from "../types";

const COLLAPSED_FOLDERS_KEY = "tayori:collapsed-folders:v1";

/** Reads browser-local folder preferences, tolerating unavailable or malformed storage. */
export function readCollapsedFolders(): Set<string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 10_000) : []);
  } catch { return new Set(); }
}

/** Saves only collapsed IDs in this browser; unavailable storage does not block navigation. */
export function saveCollapsedFolders(ids: Set<string>): void {
  try { window.localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...ids].slice(0, 10_000))); }
  catch { /* Browsers may deny storage or run out of space. */ }
}

/** Flattens the API's ordered folder tree, optionally hiding descendants of collapsed folders. */
export function flattenFolders(folders: Folder[], collapsed = new Set<string>()): Array<Folder & { depth: number }> {
  const result: Array<Folder & { depth: number }> = [];
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const group = children.get(folder.parentId) ?? [];
    group.push(folder);
    children.set(folder.parentId, group);
  }
  const walk = (parent: string | null, depth: number, ancestors: Set<string>) => {
    for (const folder of children.get(parent) ?? []) {
      if (ancestors.has(folder.id)) continue;
      result.push({ ...folder, depth });
      if (!collapsed.has(folder.id)) walk(folder.id, depth + 1, new Set(ancestors).add(folder.id));
    }
  };
  walk(null, 0, new Set());
  return result;
}
