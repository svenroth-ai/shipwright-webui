/*
 * Iterate-only Playwright config — bypasses the standing
 * `webServer: { command: 'npm run dev' }` because iterate F0.5 spawns
 * an isolated production-build server on a different port. The user
 * passes BASE_URL=http://127.0.0.1:<port> explicitly.
 */
import { defineConfig, devices } from "@playwright/test";

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
