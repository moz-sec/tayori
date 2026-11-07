import type { Folder, Scope, Source } from "../types";

export interface ArticleEmptyState {
  title: string;
  description: string;
}

/** Explains an empty result using the same descendant-folder scope as the article API. */
export function articleEmptyState({
  scope,
  folderId,
  sourceId,
  folders,
  sources,
}: {
  scope: Scope;
  folderId: string | null;
  sourceId: string | null;
  folders: Folder[];
  sources: Source[];
}): ArticleEmptyState {
  if (scope === "read-later")
    return {
      title: "あとで読む記事はありません",
      description: "記事の「あとで読む」を選ぶと、ここに保存されます。",
    };
  if (scope === "starred")
    return {
      title: "お気に入りの記事はありません",
      description: "記事をお気に入りに追加すると、ここに表示されます。",
    };
  const folderIds = new Set(folderId ? [folderId] : []);
  if (folderId) {
    // Bound traversal also tolerates malformed cyclic folder data.
    let added = true;
    while (added) {
      added = false;
      for (const folder of folders) {
        if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
          folderIds.add(folder.id);
          added = true;
        }
      }
    }
  }
  const relevant = sources.filter(
    (source) =>
      source.status !== "archived" &&
      (!sourceId || source.id === sourceId) &&
      (!folderId || (source.folderId !== null && folderIds.has(source.folderId))),
  );
  if (!relevant.length)
    return folderId
      ? {
          title: "このフォルダに購読先はありません",
          description:
            "購読先をこのフォルダや子フォルダへ追加・移動すると、記事がここに表示されます。",
        }
      : {
          title: "購読先を追加しましょう",
          description: "サイドバーからRSS / Atomの購読先を追加すると、記事がここに届きます。",
        };
  if (scope === "unread")
    return {
      title: "未読の記事はありません",
      description: "新しい記事が届くと、ここに表示されます。",
    };
  if (relevant.every((source) => source.status === "paused"))
    return {
      title: "表示できる記事はありません",
      description:
        "この範囲の購読先は一時停止中です。新しい記事を受け取るには、サイドバーで購読を再開してください。",
    };
  if (relevant.some((source) => source.errorCode))
    return {
      title: "記事はまだありません",
      description: "取得エラーのある購読先があります。サイドバーの「取得状況」を確認してください。",
    };
  if (relevant.every((source) => !source.lastCheckedAt))
    return {
      title: "記事の初回取得を待っています",
      description: "購読先は登録済みです。定期収集で記事が保存された後、一覧に表示されます。",
    };
  return {
    title: "表示できる記事はありません",
    description: "この範囲に保存済みの記事はありません。新しい記事が届くと、ここに表示されます。",
  };
}
