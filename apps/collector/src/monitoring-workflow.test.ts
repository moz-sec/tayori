import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

for (const name of ["preview", "release"]) {
  describe(`${name} deployment monitoring`, () => {
    const workflow = readFileSync(`../../.github/workflows/${name}.yml`, "utf8");
    it("passes environment variables and checks the secret before deployment", () => {
      expect(workflow).toContain(`environment: ${name === "release" ? "production" : "preview"}`);
      for (const key of [
        "TAYORI_MONITORING_ENABLED",
        "MONITOR_TICK_STALE_SECONDS",
        "MONITOR_BACKLOG_STALE_SECONDS",
        "MONITOR_FAILURE_THRESHOLD",
      ]) {
        expect(workflow).toContain(`${key}: \${{ vars.${key} ||`);
      }
      expect(workflow).toContain("MONITOR_WEBHOOK_URL: ${{ secrets.MONITOR_WEBHOOK_URL }}");
      expect(workflow).toContain(
        'if [[ "$TAYORI_MONITORING_ENABLED" == \'true\' && -z "$MONITOR_WEBHOOK_URL" ]]',
      );
      expect(workflow).toContain(
        "if [[ \"$TAYORI_D1_USAGE_ENABLED\" == 'true' || \"$TAYORI_MONITORING_ENABLED\" == 'true' ]]",
      );
      expect(workflow).toContain('--secrets-file "$TAYORI_COLLECTOR_SECRETS_FILE"');
      expect(workflow).toContain('"$TAYORI_COLLECTOR_SECRETS_FILE"\' EXIT');
    });
    it("writes only enabled secrets together with restricted permissions", () => {
      const script = workflow.match(
        /node --input-type=module -e '\n([^']*?writeFileSync\(process\.env\.TAYORI_COLLECTOR_SECRETS_FILE,[^']*?)\n\s*'/,
      )?.[1];
      expect(script).toBeDefined();
      const dir = mkdtempSync(join(tmpdir(), "tayori-workflow-test-"));
      try {
        for (const usage of [false, true])
          for (const monitor of [false, true]) {
            const file = join(dir, `${usage}-${monitor}.json`);
            const output = execFileSync(process.execPath, ["--input-type=module", "-e", script!], {
              env: {
                ...process.env,
                TAYORI_COLLECTOR_SECRETS_FILE: file,
                TAYORI_D1_USAGE_ENABLED: String(usage),
                TAYORI_MONITORING_ENABLED: String(monitor),
                D1_ANALYTICS_TOKEN: "test-token",
                MONITOR_WEBHOOK_URL: "https://example.test/hook",
              },
              encoding: "utf8",
            });
            expect(output).toBe("");
            expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
              ...(usage ? { D1_ANALYTICS_TOKEN: "test-token" } : {}),
              ...(monitor ? { MONITOR_WEBHOOK_URL: "https://example.test/hook" } : {}),
            });
            expect(statSync(file).mode & 0o777).toBe(0o600);
          }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
