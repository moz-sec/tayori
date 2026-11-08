import { request } from "./api-client";
import { humanError } from "./errors";
import { isD1QuotaCode } from "@tayori/shared/d1-errors";
import { ensureFolderPaths } from "./opml";
import type { ImportOutline, Page } from "../types";

export interface ImportRow {
  outline: ImportOutline;
  status: "pending" | "added" | "existing" | "error";
  error?: string;
}

type ImportResponse = { status: "added" | "existing" | "error"; code?: string };

/** Summarizes confirmed results and unfinished feeds without hiding partial failures. */
export function summarizeImport(rows: ImportRow[]): string {
  const count = (status: ImportRow["status"]) => rows.filter((row) => row.status === status).length;
  return `追加 ${count("added")} 件、登録済み ${count("existing")} 件、失敗 ${count("error")} 件、未処理 ${count("pending")} 件`;
}

/** Keeps confirmed results and retries only failed or unprocessed feeds. */
export async function importOpmlRows(
  previous: ImportRow[],
  onProgress: (rows: ImportRow[]) => void,
): Promise<{ rows: ImportRow[]; interrupted?: string }> {
  const rows = previous.map((row) => ({ ...row }));
  const targets = rows.flatMap((row, index) =>
    row.status === "pending" || row.status === "error" ? [index] : [],
  );
  if (!targets.length) return { rows };
  let folderIds: Map<string, string>;
  try {
    folderIds = await ensureFolderPaths(targets.map((index) => rows[index].outline.folderPath));
  } catch (error) {
    return { rows, interrupted: `フォルダを準備できませんでした。${humanError(error)}` };
  }
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batchIndexes = targets.slice(offset, offset + 5);
    try {
      const sources = batchIndexes.map((index) => {
        const item = rows[index].outline;
        return {
          url: item.url,
          title: item.title,
          siteUrl: item.siteUrl,
          folderId: folderIds.get(JSON.stringify(item.folderPath)) ?? null,
        };
      });
      const response = await request<Page<ImportResponse[]>>("/sources/import", {
        method: "POST",
        body: JSON.stringify({ sources }),
      });
      if (
        !Array.isArray(response.data) ||
        response.data.length !== batchIndexes.length ||
        response.data.some(
          (result) => !result || !["added", "existing", "error"].includes(result.status),
        )
      ) {
        throw new Error("INVALID_IMPORT_RESPONSE");
      }
      response.data.forEach((result, position) => {
        const index = batchIndexes[position];
        rows[index] = {
          outline: rows[index].outline,
          status: result.status,
          ...(result.status === "error"
            ? { error: humanError(new Error(result.code ?? "INVALID_SOURCE")) }
            : {}),
        };
      });
      onProgress([...rows]);
      const quota = response.data.find(
        (result) => result.status === "error" && isD1QuotaCode(result.code),
      )?.code;
      if (quota)
        return { rows, interrupted: `${humanError(new Error(quota))} 取り込みを中断しました。` };
    } catch (error) {
      const reason = `結果を確認できませんでした。${humanError(error)} 再試行時に登録済みか確認します。`;
      for (const index of batchIndexes)
        rows[index] = { outline: rows[index].outline, status: "error", error: reason };
      onProgress([...rows]);
      return {
        rows,
        interrupted:
          "通信または応答のエラーで取り込みを中断しました。失敗・未処理分を再試行できます。",
      };
    }
  }
  return { rows };
}
