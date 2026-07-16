/*
 * GET /api/readiness — the First-Contact readiness GATE (FR-01.51).
 *
 * Runs the shared preflight check set (`core/readiness-probe.ts`) once and
 * memoises it for a short TTL: the probe test-runs `uv`/`python`/`git`
 * `--version` (up to a few seconds each), and the wizard fetches this exactly
 * once on mount, so a per-request re-probe would be wasteful without being any
 * fresher. The Claude verdict is taken from the same live cli-compat probe the
 * diagnostics route uses (`versionInfo()`), so a CLI upgrade is reflected on the
 * next TTL window without a server restart.
 *
 * This is deliberately a SEPARATE endpoint from `/api/diagnostics` — the
 * bootstrapper polls diagnostics on every attach-vs-swap decision, and it must
 * stay a cheap identity read, never a multi-second toolchain probe.
 */

import { Hono } from "hono";

import { MIN_SUPPORTED_CLI, type ClaudeVersionInfo } from "../core/cli-compat.js";
import { probeReadiness, type ReadinessReport } from "../core/readiness-probe.js";

export function createReadinessRoutes(args: {
  versionInfo: () => ClaudeVersionInfo;
  /** Memo window; defaults to 15s. A test seam. */
  ttlMs?: number;
  /** Probe override (test seam) — defaults to the real fs + spawn probe. */
  probe?: typeof probeReadiness;
}) {
  const app = new Hono();
  const ttl = args.ttlMs ?? 15_000;
  const probe = args.probe ?? probeReadiness;
  let cached: { at: number; report: ReadinessReport } | null = null;

  app.get("/api/readiness", (c) => {
    const now = Date.now();
    // ttl <= 0 disables the memo (a test seam / opt-out); otherwise coalesce
    // within the window so a re-render storm never re-spawns the toolchain probes.
    if (!cached || ttl <= 0 || now - cached.at > ttl) {
      const v = args.versionInfo();
      const report = probe({
        claude: { supported: v.supported, raw: v.raw, minSupported: MIN_SUPPORTED_CLI },
      });
      cached = { at: now, report };
    }
    return c.json(cached.report);
  });

  return app;
}
