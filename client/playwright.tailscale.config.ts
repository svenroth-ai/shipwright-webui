import { defineConfig, devices } from '@playwright/test';

/*
 * Tailscale-target Playwright config for iterate-2026-05-10-tailscale-ws-real-browser-fix.
 *
 * Points at the user's running dev stack on the Tailscale interface
 * (Hono on 100.105.29.88:3847, Vite on 100.105.29.88:5173 narrow-bound
 * via SHIPWRIGHT_NETWORK_PROFILE=tailscale). Does NOT auto-start the
 * dev servers — assumes they're already running on the host.
 *
 * Run: npx playwright test --config=playwright.tailscale.config.ts
 *
 * The default `playwright.config.ts` keeps targeting localhost for the
 * existing E2E specs that don't care about the network profile.
 */
export default defineConfig({
  testDir: './e2e/flows',
  testMatch: /v091-tailscale-ws\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-results-tailscale.json' }], ['html', { outputFolder: 'playwright-report-tailscale' }]],
  use: {
    baseURL: 'http://pc-dinovo-002.tail4353f0.ts.net:5173',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
