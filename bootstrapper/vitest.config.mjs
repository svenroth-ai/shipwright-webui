import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    // Staged tarball dirs (built server/client) + node_modules are never tests.
    exclude: ["node_modules/**", "server/**", "client/**", "scripts/**"],
    testTimeout: 20000,
  },
});
