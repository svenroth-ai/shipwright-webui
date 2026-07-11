/*
 * Iterate-only Playwright config — bypasses the standing
 * `webServer: { command: 'npm run dev' }` because iterate F0.5 spawns
 * an isolated production-build server on a different port. The user
 * passes BASE_URL=http://127.0.0.1:<port> explicitly.
 */
import { defineConfig, devices } from "@playwright/test";

// D05 (F19/F20) — the two ADR-038 schema specs run ONLY under an isolated
// temp-USERPROFILE/HOME stack that exports SHIPWRIGHT_E2E_ISOLATED=1 (their
// isolated-store self-lock hard-aborts otherwise). Always testIgnored from the
// default project; the dedicated `schema-isolated` project is added ONLY when
// that sentinel is set, so an iterate F0.5 run of any OTHER spec neither
// collects nor throws them. (Playwright has no per-project process env, so the
// sentinel is supplied by the isolated recipe's shell.)
const SCHEMA_ISOLATED_SPECS = /(62-schema-migration|70-g-schema-persistence)\.spec\.ts$/;
const runSchemaIsolated = process.env.SHIPWRIGHT_E2E_ISOLATED === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3848",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: SCHEMA_ISOLATED_SPECS,
    },
    ...(runSchemaIsolated
      ? [
          {
            name: "schema-isolated",
            use: { ...devices["Desktop Chrome"] },
            testMatch: SCHEMA_ISOLATED_SPECS,
          },
        ]
      : []),
  ],
});
