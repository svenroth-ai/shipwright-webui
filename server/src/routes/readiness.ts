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
 * The probe is ASYNC (`execFile`) so it never blocks the event loop the live
 * terminal WebSockets + transcript poll share; concurrent requests on a cold
 * cache coalesce onto ONE in-flight probe rather than each spawning their own.
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
  let inflight: Promise<ReadinessReport> | null = null;

  app.get("/api/readiness", async (c) => {
    const now = Date.now();
    const fresh = cached !== null && ttl > 0 && now - cached.at <= ttl;
    if (fresh) return c.json((cached as { report: ReadinessReport }).report);

    // Cold/stale cache: start ONE probe and let concurrent requests await it,
    // so a burst never fans out into N parallel toolchain probes.
    if (!inflight) {
      const v = args.versionInfo();
      inflight = Promise.resolve(
        probe({ claude: { supported: v.supported, raw: v.raw, minSupported: MIN_SUPPORTED_CLI } }),
      )
        .then((report) => {
          cached = { at: Date.now(), report };
          return report;
        })
        .finally(() => {
          inflight = null;
        });
    }
    const report = await inflight;
    return c.json(report);
  });

  return app;
}
