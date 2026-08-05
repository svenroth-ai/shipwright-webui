/**
 * manifest-fixtures.mjs — shared stubs for the offline marketplace-contract
 * suites. Extracted when the deterministic half outgrew the repo's 300-line cap
 * and split into `marketplace-contract-probe.test.mjs` (how the probe behaves)
 * and `marketplace-contract-rules.test.mjs` (the rule and its loudness).
 *
 * TEST-ONLY — `package.json#files` publishes `lib/`, not `test/`.
 */

import { probeManifest } from "./manifest-probe.mjs";

/** A synthetic URL. Never fetched — every offline test injects `fetchImpl`. */
export const URL_STUB = "https://x/m.json";

/**
 * A manifest satisfying the FULL contract: parseManifest's shape rule, the
 * top-level marketplace id, and an installable `source` per entry.
 * Names are synthetic (`a`, `b`, …) on purpose — asserting a real plugin name
 * anywhere would reintroduce the coupling `lib/plugins.mjs` exists to avoid.
 */
export const good = (names) =>
  JSON.stringify({
    name: "shipwright",
    plugins: names.map((n) => ({ name: n, source: `./plugins/${n}` })),
  });

/** `probeManifest` with the retry backoff collapsed, so tests stay fast. */
export const probe = (deps) => probeManifest({ retryDelayMs: 0, sleep: async () => {}, ...deps });
