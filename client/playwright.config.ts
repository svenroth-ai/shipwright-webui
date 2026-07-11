import { defineConfig, devices } from '@playwright/test';

// iterate-2026-05-23 (terminal-selection-uxd) — make BASE_URL + webServer
// env-aware so F0.5 runs against an isolated worktree stack on a custom
// VITE_PORT. When BASE_URL is set we assume the operator has booted both
// halves themselves (Hono + Vite); we skip Playwright's webServer
// auto-spawn entirely (otherwise it tries to start `npm run dev` on the
// hardcoded :5173 and times out when the live Vite is elsewhere).
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
const skipManagedWebServer = Boolean(process.env.BASE_URL);

// D05 (F19/F20) — the two ADR-038 schema specs mutate sdk-sessions.json on
// disk and run ONLY under an isolated temp-USERPROFILE/HOME stack that exports
// SHIPWRIGHT_E2E_ISOLATED=1 (their isolated-store self-lock hard-aborts
// otherwise). They are ALWAYS testIgnored from the desktop project below; the
// dedicated `schema-isolated` project is added ONLY when that sentinel is set,
// so a plain `npm run test:e2e` on a developer's real USERPROFILE neither
// collects nor throws them. Playwright has no per-project process env
// (`env` exists only on webServer), so the sentinel MUST be exported by the
// isolated recipe's shell — gating the project on it makes the project's very
// existence imply the sentinel, and the spec's self-lock still additionally
// requires a temp-dir home so a misconfigured run fails loudly.
const SCHEMA_ISOLATED_SPECS = /(62-schema-migration|70-g-schema-persistence)\.spec\.ts$/;
const runSchemaIsolated = process.env.SHIPWRIGHT_E2E_ISOLATED === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['json', { outputFile: 'e2e-results.json' }], ['html']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // iterate-2026-05-23 (terminal-selection-uxd) — spec 86 verifies the
    // copy-on-selection pipeline by reading navigator.clipboard. Localhost
    // is a secure context, but Chromium still requires explicit permission.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    // Desktop project runs every spec EXCEPT the phone spec (which needs a
    // coarse/touch device — see plan-review C1, iterate phone-responsive-view).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/90-phone-responsive\.spec\.ts/, SCHEMA_ISOLATED_SPECS],
    },
    // Touch phone project runs ONLY the phone spec. Pixel 5 sets
    // hasTouch + isMobile + a 393px viewport so `(pointer: coarse)` and
    // `(max-width: 767px)` actually resolve true.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /90-phone-responsive\.spec\.ts/,
    },
    // D05 isolated schema guards — present ONLY under the isolated recipe
    // (SHIPWRIGHT_E2E_ISOLATED=1). See the SCHEMA_ISOLATED_SPECS note above.
    ...(runSchemaIsolated
      ? [
          {
            name: 'schema-isolated',
            use: { ...devices['Desktop Chrome'] },
            testMatch: SCHEMA_ISOLATED_SPECS,
          },
        ]
      : []),
  ],
  ...(skipManagedWebServer
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60000,
        },
      }),
});
