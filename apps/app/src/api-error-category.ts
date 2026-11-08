/** Classifies handled failures without recording messages, SQL, or arbitrary error names. */
export function apiErrorCategory(error: unknown) {
  const seen = new Set<Error>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    if (/^D1_(?:ERROR|EXEC_ERROR|TYPE_ERROR|COLUMN_NOTFOUND)(?::|$)/.test(current.message))
      return "d1_error";
    if (current.name === "TimeoutError" || current.name === "AbortError") return "timeout";
    if (current instanceof TypeError) return "type_error";
    if (current instanceof SyntaxError) return "syntax_error";
    if (current instanceof RangeError) return "range_error";
    current = current.cause;
  }
  return "unexpected";
}
