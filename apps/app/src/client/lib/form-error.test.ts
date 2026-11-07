import { describe, expect, it } from "vitest";
import { formError } from "./form-error";

describe("form error attribution", () => {
  it("attributes feed URL rejection and duplication to the URL field", () => {
    expect(formError(new Error("INVALID_FEED_URL"), "source").field).toBe("url");
    expect(formError(new Error("SOURCE_ALREADY_EXISTS"), "source").field).toBe("url");
  });
  it("distinguishes subscription display name from folder name and parent errors", () => {
    expect(formError(new Error("INVALID_NAME"), "source").field).toBe("title");
    expect(formError(new Error("INVALID_NAME"), "folder").field).toBe("name");
    expect(formError(new Error("FOLDER_CYCLE"), "folder").field).toBe("parentId");
  });
  it("keeps transport, missing-resource and unknown errors at form level", () => {
    for (const code of ["HTTP_503", "NOT_FOUND", "FOLDER_NOT_FOUND", "toString"]) {
      expect(formError(new Error(code), "source").field).toBeUndefined();
      expect(formError(new Error(code), "folder").field).toBeUndefined();
    }
  });
});
