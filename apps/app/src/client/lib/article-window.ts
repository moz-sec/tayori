import type { Page } from "../types";

/** Refreshes the loaded window from the first page, retaining its size and a valid next cursor. */
export async function loadArticleWindow<T>(count: number, load: (limit: number, cursor?: string) => Promise<Page<T[]>>): Promise<Page<T[]>> {
  const data: T[] = [];
  const target = Math.max(50, count);
  let cursor: string | undefined;
  do {
    const page = await load(Math.min(50, target - data.length), cursor);
    data.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && data.length < target);
  return { data, nextCursor: cursor ?? null };
}
