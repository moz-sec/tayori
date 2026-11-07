import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// This directory must be outside the repository and accessible only to its owner.
const directory = process.env.TAYORI_BACKUP_DIR;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const database = process.env.TAYORI_D1_DATABASE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!directory || !account || !database || !token) {
  console.error(
    "TAYORI_BACKUP_DIR, CLOUDFLARE_ACCOUNT_ID, TAYORI_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN are required",
  );
  process.exit(1);
}
const dir = resolve(directory);
const keep = 7;
const stamp = new Date().toISOString().replaceAll(":", "-");
const name = `d1-${stamp}.sql`;
const partial = join(dir, `.${name}.partial`);
const lockPath = join(dir, ".backup.lock");
let lock;
try {
  const repo = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const isInside = (path) => {
    const rel = relative(repo, path);
    return rel === "" || (!rel.startsWith(".." + "/") && rel !== ".." && !isAbsolute(rel));
  };
  if (isInside(dir)) throw new Error("Backup directory must be outside the repository");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (isInside(await realpath(dir)))
    throw new Error("Backup directory must be outside the repository");
  await chmod(dir, 0o700);
  lock = await open(lockPath, "wx", 0o600);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/export`;
  async function request(body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const json = await response.json();
    if (!response.ok || !json.success || !json.result)
      throw new Error(`D1 export API failed (${response.status})`);
    return json.result;
  }
  let result = await request({ output_format: "polling" });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (result.status !== "complete") {
    if (result.status === "error" || result.success === false) throw new Error("D1 export failed");
    if (!result.at_bookmark || Date.now() >= deadline)
      throw new Error("D1 export did not complete");
    await new Promise((done) => setTimeout(done, 2000));
    result = await request({ output_format: "polling", current_bookmark: result.at_bookmark });
  }
  const signedUrl = result.result?.signed_url;
  if (!signedUrl || new URL(signedUrl).protocol !== "https:") throw new Error("Invalid export URL");
  const response = await fetch(signedUrl, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body)
    throw new Error(`Export download failed (${response.status})`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partial, { flags: "wx", mode: 0o600 }),
  );
  if ((await stat(partial)).size === 0) throw new Error("Empty export");
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(partial)) hash.update(chunk);
  await rename(partial, join(dir, name));
  await writeFile(join(dir, `${name}.sha256`), `${hash.digest("hex")}  ${name}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const files = (await readdir(dir))
    .filter((file) => /^d1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sql$/.test(file))
    .sort()
    .reverse();
  for (const file of files.slice(keep)) {
    await rm(join(dir, file));
    await rm(join(dir, `${file}.sha256`), { force: true });
  }
  await writeFile(join(dir, "last-success"), `${new Date().toISOString()} ${name}\n`, {
    mode: 0o600,
  });
  console.log(`Backup saved: ${name}`);
} catch {
  // Network errors may contain the signed download URL or other sensitive values.
  console.error("Backup failed; check the connection, permissions, lock and available disk space");
  process.exitCode = 1;
} finally {
  if (lock) {
    await rm(partial, { force: true }).catch(() => {});
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
