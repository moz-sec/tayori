import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const backup = fileURLToPath(new URL("./backup-d1.mjs", import.meta.url));
const check = fileURLToPath(new URL("./backup-d1-check.mjs", import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t, scenario) {
  const dir = await mkdtemp(join(tmpdir(), "tayori-backup-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const preload = join(dir, "mock.mjs");
  await writeFile(
    preload,
    `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url, options = {}) => {
      appendFileSync(process.env.TRACE, JSON.stringify({url, body: options.body, authorization: options.headers?.Authorization}) + '\\n');
      if (process.env.SCENARIO === 'failure') throw new Error('secret-token signed-url-secret');
      if (process.env.SCENARIO === 'error-status') return Response.json({success:true, result:{status:'error', error:'secret-token'}});
      if (String(url).includes('/export')) {
        const request = JSON.parse(options.body);
        return Response.json({success:true, result: request.current_bookmark ? {status:'complete', result:{filename:'dump.sql', signed_url:'https://download.example/secret'}} : {at_bookmark:'bookmark'}});
      }
      return new Response('CREATE TABLE test (id INTEGER);');
    };
  `,
  );
  return {
    dir,
    env: {
      ...process.env,
      TAYORI_BACKUP_DIR: dir,
      CLOUDFLARE_ACCOUNT_ID: "account",
      TAYORI_D1_DATABASE_ID: "database",
      CLOUDFLARE_API_TOKEN: "secret-token",
      TRACE: join(dir, "trace"),
      SCENARIO: scenario,
    },
    preload,
  };
}

test("exports, polls, stores privately and rotates only matching backup names", async (t) => {
  const f = await fixture(t, "success");
  for (let day = 1; day <= 8; day++) {
    const name = `d1-2020-01-${String(day).padStart(2, "0")}T03-00-00.000Z.sql`;
    await writeFile(join(f.dir, name), "old");
    await writeFile(join(f.dir, `${name}.sha256`), "hash");
  }
  await writeFile(join(f.dir, "d1-2020-01-01Timportant.sql"), "keep");
  await exec(process.execPath, ["--import", f.preload, backup], { env: f.env });
  const files = await readdir(f.dir);
  assert.equal(
    files.filter((name) => /^d1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sql$/.test(name))
      .length,
    7,
  );
  assert.equal(await readFile(join(f.dir, "d1-2020-01-01Timportant.sql"), "utf8"), "keep");
  assert.equal((await stat(f.dir)).mode & 0o777, 0o700);
  const [, name] = (await readFile(join(f.dir, "last-success"), "utf8")).trim().split(" ");
  assert.equal((await stat(join(f.dir, name))).mode & 0o777, 0o600);
  assert.match(await readFile(join(f.dir, `${name}.sha256`), "utf8"), /^[a-f0-9]{64}  d1-/);
  const requests = (await readFile(f.env.TRACE, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    requests.slice(0, 2).map((r) => JSON.parse(r.body)),
    [{ output_format: "polling" }, { output_format: "polling", current_bookmark: "bookmark" }],
  );
  assert.equal(requests[2].authorization, undefined);
  await exec(process.execPath, [check], { env: f.env });
  await writeFile(join(f.dir, name), "corrupt");
  await assert.rejects(exec(process.execPath, [check], { env: f.env }));
});

test("failure preserves existing backups, does not expose secrets and stale state fails check", async (t) => {
  const f = await fixture(t, "failure");
  const name = "d1-2020-01-01T03-00-00.000Z.sql";
  await writeFile(join(f.dir, name), "old");
  await assert.rejects(
    exec(process.execPath, ["--import", f.preload, backup], { env: f.env }),
    (error) => {
      assert.doesNotMatch(error.stderr, /secret-token|signed-url-secret/);
      return true;
    },
  );
  assert.equal(await readFile(join(f.dir, name), "utf8"), "old");
  assert.ok(!(await readdir(f.dir)).includes(".backup.lock"));
  await assert.rejects(exec(process.execPath, [check], { env: f.env }));
  await writeFile(join(f.dir, "last-success"), `2020-01-01T00:00:00.000Z ${name}\n`);
  await assert.rejects(exec(process.execPath, [check], { env: f.env }));
});

test("restores data and invalidates jobs on old and current schemas", async () => {
  const migration1 = await readFile(join(root, "migrations/0001_initial.sql"), "utf8");
  const migration2 = await readFile(join(root, "migrations/0002_collection_schedule.sql"), "utf8");
  const migrationNames = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const currentMigrations = (
    await Promise.all(
      migrationNames.map((name) => readFile(join(root, "migrations", name), "utf8")),
    )
  ).join("\n");
  const safety = await readFile(join(root, "scripts/restore-d1-safety.sql"), "utf8");
  for (const current of [false, true]) {
    const db = new DatabaseSync(":memory:");
    db.exec(current ? currentMigrations : migration1 + migration2);
    db.exec(`INSERT INTO sources(id, normalized_url, title, generation) VALUES('s','https://example.test','Feed',2);
      INSERT INTO item_keys VALUES('a','s','key',1);
      INSERT INTO articles(id,title,url,read_at,starred,read_later,first_seen_at,expires_at) VALUES('a','Article','https://example.test/a',2,1,1,1,999);
      INSERT INTO fetch_jobs(id,source_id,generation,status) VALUES('j','s',3,'sent');`);
    db.exec(safety);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.deepEqual(
      Object.values(
        db
          .prepare(
            "SELECT s.generation,k.key_hash,a.read_at,a.starred,a.read_later,j.status FROM sources s JOIN item_keys k ON k.source_id=s.id JOIN articles a ON a.id=k.id JOIN fetch_jobs j ON j.source_id=s.id",
          )
          .get(),
      ),
      [4, "key", 2, 1, 1, "failed"],
    );
    db.close();
  }
});

test("rejects repository and symlinked repository destinations", async (t) => {
  const f = await fixture(t, "success");
  await assert.rejects(
    exec(process.execPath, ["--import", f.preload, backup], {
      env: { ...f.env, TAYORI_BACKUP_DIR: root },
    }),
  );
  const { symlink } = await import("node:fs/promises");
  const link = join(f.dir, "repo-link");
  await symlink(root, link);
  await assert.rejects(
    exec(process.execPath, ["--import", f.preload, backup], {
      env: { ...f.env, TAYORI_BACKUP_DIR: link },
    }),
  );
  await assert.rejects(readFile(f.env.TRACE));
});

test("rejects an API error status without retaining or exposing its message", async (t) => {
  const f = await fixture(t, "error-status");
  await assert.rejects(
    exec(process.execPath, ["--import", f.preload, backup], { env: f.env }),
    (error) => {
      assert.doesNotMatch(error.stderr, /secret-token/);
      return true;
    },
  );
  assert.ok(!(await readdir(f.dir)).includes("last-success"));
});
