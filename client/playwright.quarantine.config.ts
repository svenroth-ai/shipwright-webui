import { defineConfig, devices } from "@playwright/test";

if (!process.env.BASE_URL) {
  throw new Error("Set BASE_URL to the explicitly prepared live stack before running quarantined probes.");
}

// The only live-stack E2E surface. Keep this config separate from the normal
// suite so a live-stack opt-in cannot unlock mutable chromium/mobile projects.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    {
      name: "quarantine",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /v0-9-3-ac2-resume-cta-visibility\.spec\.ts$/,
    },
  ],
});
