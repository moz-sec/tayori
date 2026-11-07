import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use the same database ID and persistence directory as db:migrate:local and Vite.
// --local is mandatory: this command never writes to a remote D1 database.
const result = spawnSync(
  "cf",
  [
    "d1",
    "raw",
    process.env.TAYORI_D1_DATABASE_ID ?? "00000000-0000-4000-8000-000000000001",
    "--local",
    "--persist-to",
    ".cloudflare/state",
    `--sql=${readFileSync(new URL("./seed-local.sql", import.meta.url), "utf8")}`,
  ],
  {
    cwd: fileURLToPath(new URL("../apps/app/", import.meta.url)),
    stdio: "inherit",
  },
);

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
