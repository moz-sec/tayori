import { humanError } from "./errors";

export interface FormError {
  message: string;
  field?: string;
}

/** Only attribute an error to a field when the API code identifies that field. */
export function formError(error: unknown, form: "source" | "folder"): FormError {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const fields: Record<string, string> =
    form === "source"
      ? { INVALID_FEED_URL: "url", SOURCE_ALREADY_EXISTS: "url", INVALID_NAME: "title" }
      : { INVALID_NAME: "name", FOLDER_ALREADY_EXISTS: "name", FOLDER_CYCLE: "parentId" };
  return {
    message:
      code === "INVALID_NAME"
        ? "名前は空白以外の文字を含む100文字以内で入力してください。"
        : humanError(error),
    field: Object.hasOwn(fields, code) ? fields[code] : undefined,
  };
}
