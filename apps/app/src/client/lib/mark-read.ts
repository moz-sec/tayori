import { request } from "./api-client";

export interface MarkReadResult {
  completed: number;
  updated: number;
  remainingIds: string[];
  error?: unknown;
}

/** Marks a snapshot of selected IDs, stopping at the first failed batch so only unconfirmed IDs need retry. */
export async function markArticlesRead(
  articleIds: readonly string[],
  send: (ids: string[]) => Promise<{ data: { updated: number } }> = (ids) => request("/articles/read", {
    method: "POST", body: JSON.stringify({ articleIds: ids, read: true }),
  }),
): Promise<MarkReadResult> {
  const ids = [...new Set(articleIds)];
  let completed = 0;
  let updated = 0;
  while (completed < ids.length) {
    try {
      const batch = ids.slice(completed, completed + 50);
      const result = await send(batch);
      completed += batch.length;
      updated += result.data.updated;
    } catch (error) {
      return { completed, updated, remainingIds: ids.slice(completed), error };
    }
  }
  return { completed, updated, remainingIds: [] };
}
