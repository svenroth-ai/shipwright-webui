import { defineConfig, devices } from '@playwright/test';

// iterate-2026-05-23 (terminal-selection-uxd) — make BASE_URL + webServer
// env-aware so F0.5 runs against an isolated worktree stack on a custom
// VITE_PORT. When BASE_URL is set we assume the operator has booted both
// halves themselves (Hono + Vite); we skip Playwright's webServer
// auto-spawn entirely (otherwise it tries to start `npm run dev` on the
// hardcoded :5173 and times out when the live Vite is elsewhere).
//
// A00 (iterate-2026-07-10-harness-hardening): the default is now IPv4. Node
// resolves `localhost` to `::1` first while the Hono bind is v4 — a trap this
// repo has hit repeatedly. Every env-dependent value in the suite is derived in
// e2e/helpers/env.ts; this file and that helper read the SAME `BASE_URL`.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
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

// ── A00: QUARANTINE ─────────────────────────────────────────────────────────
// Specs that CANNOT run against an isolated stack because they assert on a live
// machine artefact. They are NOT deleted and NOT silently skipped — they live in
// a named project you can run and, crucially, COUNT. A quarantine is a list you
// can count; a skipped assertion is not. Every entry needs a one-line reason.
//
//   v091-tailscale-ws — asserts the CORS / WS-origin chain against a real
//     Tailscale MagicDNS hostname. The literal origins inside it are the SUBJECT
//     of its assertions, not incidental config. Needs a tailnet; already carries
//     its own `playwright.tailscale.config.ts`.
//
//   e2e/quarantine/** — one entry today:
//     v0-9-3-ac2-resume-cta-visibility — the Resume CTA's visibility is derived
//       from live-session detection, which needs a real `claude` process holding
//       the pty. An isolated stack has no claude binary; the CTA correctly
//       reappears. Weakening the assertion would leave a green test checking
//       nothing. (Its sibling AC-1 — the actual ping-pong regression fence — DOES
//       run, in e2e/flows/v0-9-3-resume-state-machine.spec.ts.)
const QUARANTINE_SPECS = [/v091-tailscale-ws\.spec\.ts$/, /quarantine[\\/].*\.spec\.ts$/];

// The visual project owns e2e/visual/**; the functional projects must not also
// collect it (a screenshot assertion running under `chromium` would resolve no
// baseline and silently write one).
const VISUAL_SPECS = /visual[\\/].*\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['json', { outputFile: 'e2e-results.json' }], ['html', { open: 'never' }]],
  // A00 — deterministic, platform-agnostic baseline paths. Playwright's default
  // template appends the platform (…-win32.png / …-linux.png). We deliberately do
  // NOT: baselines are generated in exactly ONE environment (the pinned Linux
  // container CI runs), so a Windows-generated PNG must never be able to
  // masquerade as a valid baseline under a different filename. A stable path is
  // also what lets the manifest guard predict and assert each route's baseline.
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{arg}{ext}',
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
    // coarse/touch device — see plan-review C1, iterate phone-responsive-view),
    // the schema-isolated pair, the visual suite, and the quarantine list.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [
        /90-phone-responsive\.spec\.ts/,
        SCHEMA_ISOLATED_SPECS,
        VISUAL_SPECS,
        ...QUARANTINE_SPECS,
      ],
    },
    // Touch phone project runs ONLY the phone spec. Pixel 5 sets
    // hasTouch + isMobile + a 393px viewport so `(pointer: coarse)` and
    // `(max-width: 767px)` actually resolve true.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /90-phone-responsive\.spec\.ts/,
    },
    // A00 — visual regression. Deterministic capture is the whole game: a
    // baseline that drifts is worse than no baseline, because it trains people to
    // reach for `--update-snapshots` reflexively. Fixed viewport, animations off,
    // seeded fixtures only, live pty masked (see e2e/visual/*.spec.ts).
    {
      name: 'visual',
      testMatch: VISUAL_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
      },
      expect: {
        toHaveScreenshot: {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
          // Tight enough to BITE. A threshold so loose it never fails is the
          // same as having no gate at all (A00 AC1).
          maxDiffPixelRatio: 0.01,
        },
      },
    },
    // A00 — quarantine. Runnable on demand (`npm run test:e2e:quarantine`) on a
    // machine that HAS the prerequisite; never part of the default run or of CI.
    {
      name: 'quarantine',
      use: { ...devices['Desktop Chrome'] },
      testMatch: QUARANTINE_SPECS,
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
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: true,
          timeout: 60000,
        },
      }),
});
