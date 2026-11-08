import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyD1QuotaError, secondsUntilNextUtcDay } from "@tayori/shared/d1-errors";
import { humanError } from "./client/lib/errors";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

const read = "free tier daily row read limit";
const write = "free tier daily row write limit";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("D1 quota errors", () => {
  it.each([
    [read, "D1_DAILY_READ_LIMIT"],
    [write, "D1_DAILY_WRITE_LIMIT"],
    ["Exceeded maximum DB size", "D1_DATABASE_STORAGE_LIMIT"],
    ["D1's maximum account storage limit", "D1_ACCOUNT_STORAGE_LIMIT"],
  ])("classifies documented signature %s in wrapped errors", (message, code) => {
    expect(
      classifyD1QuotaError(new Error("D1_ERROR", { cause: new Error(`${message}: test suffix`) })),
    ).toBe(code);
    expect(humanError(new Error(code))).not.toContain(code);
  });
  it("does not confuse SQL or other limits and terminates on cyclic causes", () => {
    for (const message of [
      "too many SQL variables",
      "maximum query limit",
      "row read limit",
      "SQLITE_FULL",
    ])
      expect(classifyD1QuotaError(new Error(message))).toBeNull();
    const error = new Error("unrelated");
    Object.defineProperty(error, "cause", { value: error });
    expect(classifyD1QuotaError(error)).toBeNull();
  });
  it("calculates UTC midnight at and across the boundary", () => {
    expect(secondsUntilNextUtcDay(Date.parse("2026-11-07T23:59:59.500Z"))).toBe(1);
    expect(secondsUntilNextUtcDay(Date.parse("2026-11-08T00:00:00.000Z"))).toBe(86400);
  });
  it.each([
    [read, "D1_DAILY_READ_LIMIT", "1"],
    ["Exceeded maximum DB size", "D1_DATABASE_STORAGE_LIMIT", null],
  ])("returns a safe 503 on the settings subroute", async (message, code, retry) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T23:59:59.500Z"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = sqliteD1();
    db.state.beforeQuery = () => {
      throw new Error(`D1_ERROR: ${message}: private SQL and URL`);
    };
    const res = await api.request("http://localhost/api/v1/settings/collection-schedule", {}, {
      DB: db.binding,
    } as Env);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(retry);
    expect(await res.json()).toEqual({ error: { code } });
    expect(log).toHaveBeenCalledWith({ event: "d1_quota_exceeded", code });
    db.sqlite.close();
  });
  it("keeps ordinary errors as 500 and folder quota errors as 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = sqliteD1();
    db.state.beforeQuery = () => {
      throw new Error("too many SQL variables");
    };
    const ordinary = await api.request("http://localhost/api/v1/settings/collection-schedule", {}, {
      DB: db.binding,
    } as Env);
    expect(ordinary.status).toBe(500);
    db.state.beforeQuery = () => {
      throw new Error(`D1_ERROR: ${write}`);
    };
    const folder = await api.request(
      "http://localhost/api/v1/folders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ name: "folder", parentId: null }),
      },
      { DB: db.binding } as Env,
    );
    expect(folder.status).toBe(503);
    expect(await folder.json()).toEqual({ error: { code: "D1_DAILY_WRITE_LIMIT" } });
    db.sqlite.close();
  });
});

it("keeps successful source creation when only initial dispatch hits quota", async () => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = sqliteD1();
  db.state.beforeQuery = (sql) => {
    if (sql.includes("INSERT INTO fetch_jobs")) throw new Error(`D1_ERROR: ${write}: private`);
  };
  const send = vi.fn();
  const response = await api.request(
    "http://localhost/api/v1/sources",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/feed" }),
    },
    { DB: db.binding, JOBS: { send } } as unknown as Env,
  );
  expect(response.status).toBe(201);
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sources").get()).toEqual({ n: 1 });
  expect(send).not.toHaveBeenCalled();
  expect(logger).toHaveBeenCalledWith({ event: "d1_quota_exceeded", code: "D1_DAILY_WRITE_LIMIT" });
  db.sqlite.close();
});

it("preserves folder unique conflicts as 409", async () => {
  const db = sqliteD1();
  db.sqlite.exec("INSERT INTO folders(id, name) VALUES ('b', 'Duplicate')");
  const response = await api.request(
    "http://localhost/api/v1/folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ name: "Duplicate", parentId: null }),
    },
    { DB: db.binding } as Env,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: { code: "FOLDER_ALREADY_EXISTS" } });
  db.sqlite.close();
});
