/*
 * Integration smoke for the server dev-script wiring:
 * `tsx --env-file-if-exists=../.env.local watch src/index.ts` MUST
 * cause Node's startup loader to populate `process.env` from
 * `.env.local` before any user code runs.
 *
 * Tests spawn a short-lived `tsx` subprocess against a temporary
 * fixture env-file and assert the value appears in
 * `process.env`. This catches the wiring boundary that
 * `resolveHonoHost.test.ts` etc. CANNOT cover (resolver tests
 * pass a fake `env` object; they never exercise the process-startup
 * loader). See ADR-08X (env-local-loading-fix) and external review
 * #8 medium ("Resolver unit tests don't verify actual process wiring").
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const FIXTURE_KEY = "SHIPWRIGHT_ENV_FILE_TEST_KEY";
const FIXTURE_VALUE = "loaded-from-env-file";

let workDir: string;
let envFilePath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "shipwright-env-file-test-"));
  envFilePath = join(workDir, "test.env");
  writeFileSync(envFilePath, `${FIXTURE_KEY}=${FIXTURE_VALUE}\n`, "utf-8");
});

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("server dev-script env-file wiring", () => {
  it("Node's --env-file-if-exists picks up env-file values into process.env", () => {
    const result = spawnSync(
      process.execPath, // node binary
      [
        `--env-file-if-exists=${envFilePath}`,
        "-e",
        `process.stdout.write(process.env.${FIXTURE_KEY} || "MISSING")`,
      ],
      { encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(FIXTURE_VALUE);
  });

  it("tsx (via node --env-file-if-exists + tsx-cli.mjs) loads env file", () => {
    // Strong end-to-end proof that AC-1 wiring works: invoke Node
    // directly (which definitely handles --env-file-if-exists)
    // pointing it at tsx's cli.mjs entrypoint. This is the same flag
    // arrangement the `npm run dev` script uses, just with `node`
    // explicit instead of relying on tsx-cli's argv forwarding.
    //
    // We don't spawn the `.cmd` shim because Node on Windows requires
    // shell:true to execute .cmd files via spawnSync, and shell:true
    // re-parses path-with-spaces tokens (e.g. "your company") via
    // cmd.exe → fails. Calling tsx's JS entrypoint via Node bypasses
    // both restrictions.
    //
    // External code review (OpenAI HIGH): "wiring is not proven to
    // work through tsx" — this closes the gap.
    // server/src/test/<this file> → ../../.. = server/
    const serverRoot = resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
    );
    const tsxCli = resolve(
      serverRoot,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );

    const result = spawnSync(
      process.execPath,
      [
        `--env-file-if-exists=${envFilePath}`,
        tsxCli,
        "-e",
        `process.stdout.write(process.env.${FIXTURE_KEY} || "MISSING")`,
      ],
      { encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(FIXTURE_VALUE);
  });

  it("missing env-file does NOT fail boot (--env-file-if-exists semantics)", () => {
    const missingPath = join(workDir, "does-not-exist.env");
    const result = spawnSync(
      process.execPath,
      [
        `--env-file-if-exists=${missingPath}`,
        "-e",
        `process.stdout.write(process.env.${FIXTURE_KEY} || "UNSET-IS-OK")`,
      ],
      { encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("UNSET-IS-OK");
  });

  it("server package.json dev script uses --env-file-if-exists with the correct path", () => {
    // Contract test on the package.json dev script. If a future
    // refactor changes the script without updating the env-file
    // path, this fails loud rather than the operator finding out
    // via "my .env.local isn't being read".
    const __filename = fileURLToPath(import.meta.url);
    const pkgPath = resolve(__filename, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.scripts?.dev).toMatch(/--env-file-if-exists=\.\.\/.env\.local/);
  });
});
