import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
const dir = process.env.TAYORI_BACKUP_DIR;
if (!dir) {
  console.error("TAYORI_BACKUP_DIR is required");
  process.exit(1);
}
try {
  const [stamp, name] = (await readFile(join(dir, "last-success"), "utf8")).trim().split(" ");
  const age = Date.now() - Date.parse(stamp);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 26 * 60 * 60 * 1000 ||
    !/^d1-[\w.T-]+\.sql$/.test(name)
  )
    throw new Error("No recent successful backup");
  if ((await stat(join(dir, name))).size === 0) throw new Error("Backup is empty");
  const checksum = (await readFile(join(dir, `${name}.sha256`), "utf8")).trim();
  const expected = `${name}`;
  const match = /^([a-f0-9]{64})  (.+)$/.exec(checksum);
  if (!match || match[2] !== expected) throw new Error("Invalid checksum file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(dir, name))) hash.update(chunk);
  if (hash.digest("hex") !== match[1]) throw new Error("Checksum mismatch");
  console.log(`Backup is current: ${stamp}`);
} catch (error) {
  console.error(`Backup check failed: ${error.message}`);
  process.exitCode = 1;
}
