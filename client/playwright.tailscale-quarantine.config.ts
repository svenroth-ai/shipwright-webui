import { defineConfig, devices } from "@playwright/test";

// The MagicDNS probe has its own literal public endpoints. Keep it in a
// separate config from transcript seeding: it requires a running Tailscale
// stack, but must never inherit that stack's operator HOME for fixtures.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    {
      name: "tailscale-quarantine",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /v091-tailscale-ws\.spec\.ts$/,
    },
  ],
});
