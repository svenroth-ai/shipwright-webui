import { defineConfig, devices } from '@playwright/test';

// iterate-2026-05-23 (terminal-selection-uxd) — make BASE_URL + webServer
// env-aware so F0.5 runs against an isolated worktree stack on a custom
// VITE_PORT. When BASE_URL is set we assume the operator has booted both
// halves themselves (Hono + Vite); we skip Playwright's webServer
// auto-spawn entirely (otherwise it tries to start `npm run dev` on the
// hardcoded :5173 and times out when the live Vite is elsewhere).
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
const skipManagedWebServer = Boolean(process.env.BASE_URL);

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
      testIgnore: /90-phone-responsive\.spec\.ts/,
    },
    // Touch phone project runs ONLY the phone spec. Pixel 5 sets
    // hasTouch + isMobile + a 393px viewport so `(pointer: coarse)` and
    // `(max-width: 767px)` actually resolve true.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /90-phone-responsive\.spec\.ts/,
    },
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
