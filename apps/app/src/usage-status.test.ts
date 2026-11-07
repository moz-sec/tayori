import { afterEach, expect, it, vi } from "vitest";
import { writeD1UsageConfig, writeD1UsageSnapshot } from "@tayori/shared/d1-usage";
import { api } from "./api";
import { sqliteD1 } from "../../collector/src/test/sqlite-d1";

it("reports usage stop and source status while allowing reads and deferring initial collection", async () => {
  const now = Date.parse("2026-10-18T01:00:00Z");
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const db = sqliteD1();
  const send = vi.fn();
  const env = { DB: db.binding, JOBS: { send } } as unknown as Env;
  await writeD1UsageConfig(db.binding, {
    enabled: true,
    limits: {
      storageBytes: 100,
      rowsRead: 100,
      rowsWritten: 100,
      warningRatio: 0.8,
      maxAgeSeconds: 3600,
    },
  });
  await writeD1UsageSnapshot(db.binding, {
    observedAt: new Date(now).toISOString(),
    dayUtc: "2026-10-18",
    storageBytes: 100,
    rowsRead: 1,
    rowsWritten: 1,
  });
  db.sqlite
    .exec(`INSERT INTO sources(id,title,normalized_url,status,last_success_at,consecutive_failures) VALUES ('existing','Existing','https://example.com/feed','active',${now / 1000 - 60},2);
    INSERT INTO item_keys(id,source_id,key_hash,first_seen_at) VALUES ('a','existing','hash',1);
    INSERT INTO articles(id,title,url,first_seen_at,expires_at,starred) VALUES ('a','Saved','https://example.com/a',1,2,1);`);
  db.state.queries = 0;
  const status = await api.request("http://localhost/api/v1/status", {}, env);
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({
    data: {
      d1Usage: { state: "stopped", reason: "limit_reached", metrics: ["storageBytes"] },
      lastSuccessAt: new Date(now - 60_000).toISOString(),
      maxConsecutiveFailures: 2,
      oldestPendingAt: null,
      queueBudgetStopped: false,
    },
  });
  db.state.queries = 0;
  const articles = await api.request("http://localhost/api/v1/articles", {}, env);
  expect(articles.status).toBe(200);
  expect(await articles.json()).toMatchObject({ data: [{ id: "a", saved: true }] });
  db.state.queries = 0;
  const created = await api.request(
    "http://localhost/api/v1/sources",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ url: "https://example.com/new" }),
    },
    env,
  );
  expect(created.status).toBe(201);
  expect(send).not.toHaveBeenCalled();
  expect(db.sqlite.prepare("SELECT id FROM fetch_jobs").all()).toHaveLength(0);
  db.sqlite.close();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
