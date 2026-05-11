import { defineConfig, devices } from '@playwright/test';

/*
 * Tailscale-target Playwright config — points at the user's running dev
 * stack on the Tailscale interface (Hono on :3847, Vite on :5173, bound
 * via SHIPWRIGHT_NETWORK_PROFILE=tailscale or HONO_HOST/VITE_HOST). Does
 * NOT auto-start the dev servers — assumes they're already up.
 *
 * Run: npx playwright test --config=playwright.tailscale.config.ts
 *
 * The default `playwright.config.ts` keeps targeting localhost for the
 * existing E2E specs that don't care about the network profile. Tailscale
 * specs are explicit-list rather than glob to avoid accidentally globbing
 * in underscore-prefixed diagnostic specs (per ADR-084 external review
 * gemini #4).
 */
export default defineConfig({
  testDir: './e2e/flows',
  testMatch: [
    'v091-tailscale-ws.spec.ts',
    'v0-9-2-embedded-terminal-mount-races.spec.ts',
    'v0-9-3-resume-state-machine.spec.ts',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-results-tailscale.json' }], ['html', { outputFolder: 'playwright-report-tailscale' }]],
  use: {
    baseURL: 'http://webui-host.tailnet.ts.net:5173',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
