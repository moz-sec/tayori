import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

afterEach(() => vi.restoreAllMocks());

it.each([
  [
    new Error("wrapper", { cause: new Error("D1_ERROR: SECRET SQL https://private.test") }),
    "d1_error",
  ],
  [new TypeError("SECRET https://private.test"), "type_error"],
  [Object.assign(new Error("SECRET SQL"), { name: "SECRET https://private.test" }), "unexpected"],
])(
  "logs a finite category and response correlation without private details",
  async (error, category) => {
    const db = sqliteD1();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      db.state.beforeQuery = () => {
        throw error;
      };
      const response = await api.request("http://localhost/api/v1/sources", {}, {
        DB: db.binding,
      } as Env);
      const body = (await response.json()) as { error: { code: string; requestId: string } };
      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.requestId).toEqual(expect.any(String));
      expect(log).toHaveBeenCalledWith({
        event: "api_error",
        requestId: body.error.requestId,
        category,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
      expect(JSON.stringify(body)).not.toContain("private.test");
    } finally {
      db.sqlite.close();
    }
  },
);

function importRequest(db: D1Database, urls: string[]) {
  return api.request(
    "http://localhost/api/v1/sources/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ sources: urls.map((url) => ({ url })) }),
    },
    { DB: db, JOBS: { send: vi.fn().mockResolvedValue(undefined) } } as unknown as Env,
  );
}

it("retains added and existing rows when a later item exceeds quota and stops remaining inserts", async () => {
  const db = sqliteD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    db.sqlite.exec(
      "INSERT INTO sources(id,title,normalized_url) VALUES ('existing','Existing','https://example.test/existing')",
    );
    let inserts = 0;
    db.state.beforeQuery = (sql) => {
      if (sql.startsWith("INSERT INTO sources") && ++inserts === 3)
        throw new Error("D1_ERROR: free tier daily row write limit: SECRET");
    };
    const response = await importRequest(db.binding, [
      "https://example.test/first",
      "https://example.test/existing",
      "https://example.test/quota",
      "https://example.test/later",
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        { status: "added", source: { url: "https://example.test/first" } },
        { status: "existing", source: { url: "https://example.test/existing" } },
        { status: "error", code: "D1_DAILY_WRITE_LIMIT" },
        { status: "error", code: "D1_DAILY_WRITE_LIMIT" },
      ],
    });
    expect(inserts).toBe(3);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sources").get()?.n).toBe(2);
  } finally {
    db.sqlite.close();
  }
});

it("retains confirmed rows if quota occurs while looking up an existing source", async () => {
  const db = sqliteD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    db.sqlite.exec(
      "INSERT INTO sources(id,title,normalized_url) VALUES ('existing','Existing','https://example.test/existing')",
    );
    db.state.beforeQuery = (sql) => {
      if (sql === "SELECT * FROM sources WHERE normalized_url = ?")
        throw new Error("D1_ERROR: free tier daily row read limit");
    };
    const response = await importRequest(db.binding, [
      "https://example.test/first",
      "https://example.test/existing",
      "https://example.test/later",
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        { status: "added" },
        { status: "error", code: "D1_DAILY_READ_LIMIT" },
        { status: "error", code: "D1_DAILY_READ_LIMIT" },
      ],
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sources").get()?.n).toBe(2);
  } finally {
    db.sqlite.close();
  }
});

it("propagates an unexpected database failure instead of labelling it an invalid source", async () => {
  const db = sqliteD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    db.state.beforeQuery = (sql) => {
      if (sql.startsWith("INSERT INTO sources"))
        throw new Error("D1_ERROR: SECRET internal failure");
    };
    const response = await importRequest(db.binding, ["https://example.test/first"]);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  } finally {
    db.sqlite.close();
  }
});

it("keeps validation errors per item and continues valid rows", async () => {
  const db = sqliteD1();
  try {
    const response = await importRequest(db.binding, ["invalid", "https://example.test/first"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ status: "error", code: "INVALID_FEED_URL" }, { status: "added" }],
    });
  } finally {
    db.sqlite.close();
  }
});
