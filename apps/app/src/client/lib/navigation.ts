import type { Folder, Scope, Source } from "../types";

export interface NavigationView {
  scope: Scope;
  folderId: string | null;
  sourceId: string | null;
}
export const ALL_ARTICLES: NavigationView = { scope: "all", folderId: null, sourceId: null };
const scopes = new Set<Scope>(["all", "unread", "read-later", "starred"]);
const readId = (value: string | null) =>
  value && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : null;

/** A specific feed takes precedence over a folder; either uses the all-articles scope. */
export function readNavigation(href: string): NavigationView {
  const query = new URL(href, "https://tayori.invalid").searchParams;
  const sourceId = readId(query.get("sourceId"));
  const folderId = sourceId ? null : readId(query.get("folderId"));
  const requestedScope = query.get("scope") as Scope;
  return {
    scope: sourceId || folderId ? "all" : scopes.has(requestedScope) ? requestedScope : "all",
    folderId,
    sourceId,
  };
}

/** Preserve unrelated parameters and fragments while replacing all view parameters together. */
export function navigationHref(view: NavigationView, href = "/"): string {
  const url = new URL(href, "https://tayori.invalid");
  for (const key of ["scope", "folderId", "sourceId", "cursor"]) url.searchParams.delete(key);
  if (view.sourceId) url.searchParams.set("sourceId", view.sourceId);
  else if (view.folderId) url.searchParams.set("folderId", view.folderId);
  else if (view.scope !== "all") url.searchParams.set("scope", view.scope);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Archived or removed selections become the all-articles view without creating a history entry. */
export function validateNavigation(
  view: NavigationView,
  folders: Pick<Folder, "id">[],
  sources: Pick<Source, "id" | "status">[],
): NavigationView {
  if (view.folderId && !folders.some((folder) => folder.id === view.folderId)) return ALL_ARTICLES;
  if (
    view.sourceId &&
    !sources.some((source) => source.id === view.sourceId && source.status !== "archived")
  )
    return ALL_ARTICLES;
  return view;
}

export const navigationKey = (view: NavigationView) =>
  JSON.stringify([view.scope, view.folderId, view.sourceId]);

/** Leave modified clicks and download/target links to the browser. */
export function isPlainNavigation(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
