import { request } from "./api-client";
import type { Folder, ImportOutline, Page } from "../types";

/** Validates an OPML file and parses its feeds and folder hierarchy. */
export async function parseOpmlFile(file: File): Promise<ImportOutline[]> {
  if (file.size > 1024 * 1024) throw new Error("OPML_FILE_TOO_LARGE");
  const xml = await file.text();
  if (/<!DOCTYPE/i.test(xml)) throw new Error("OPML_DOCTYPE_NOT_ALLOWED");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "opml") throw new Error("INVALID_OPML");
  const body = doc.querySelector("opml > body, body");
  if (!body) throw new Error("INVALID_OPML");
  const items: ImportOutline[] = [];
  /** Recursively collects outline entries while preserving their folder hierarchy. */
  const walk = (parent: Element, path: string[], depth: number) => {
    if (depth > 10) throw new Error("OPML_TOO_DEEP");
    for (const outline of Array.from(parent.children).filter((node) => node.localName.toLowerCase() === "outline")) {
      const url = outline.getAttribute("xmlUrl") ?? outline.getAttribute("xmlurl");
      const title = (outline.getAttribute("title") ?? outline.getAttribute("text") ?? "").trim().slice(0, 100);
      if (url) {
        if (/^https?:\/\//i.test(url)) {
          if (items.length >= 200) throw new Error("OPML_FEED_LIMIT");
          items.push({ title, url, siteUrl: outline.getAttribute("htmlUrl") ?? undefined, folderPath: path });
        }
      } else walk(outline, title ? [...path, title] : path, depth + 1);
    }
  };
  walk(body, [], 0);
  return items;
}

/** Resolves OPML folder paths to D1 folders, creating any that are missing. */
export async function ensureFolderPaths(paths: string[][]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const existing = (await request<Page<Folder[]>>("/folders")).data;
  for (const path of paths) {
    let parentId: string | null = null;
    const accumulated: string[] = [];
    for (const name of path) {
      accumulated.push(name);
      const key = JSON.stringify(accumulated);
      const found = existing.find((folder) => folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase());
      if (found) parentId = found.id;
      else {
        const created: Page<{ id: string }> = await request<Page<{ id: string }>>("/folders", { method: "POST", body: JSON.stringify({ name, parentId }) });
        const createdId: string = created.data.id;
        parentId = createdId;
        existing.push({ id: createdId, parentId: accumulated.length > 1 ? ids.get(JSON.stringify(accumulated.slice(0, -1))) ?? null : null, name, sortOrder: 0, unreadCount: 0 });
      }
      if (parentId) ids.set(key, parentId);
    }
  }
  return ids;
}
