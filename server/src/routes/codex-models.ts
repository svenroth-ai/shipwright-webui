/*
 * GET /api/codex-models — the Codex model-catalog endpoint
 * (iterate-2026-09-19-codex-model-catalog).
 *
 * Mirrors `routes/readiness.ts`'s in-memory TTL cache + inflight-coalescing
 * shape (a deliberately SEPARATE cache lifetime from readiness's own —
 * architecture review, glm: grafting this onto the readiness endpoint would
 * couple two probes with different freshness/degradation semantics).
 *
 * Global route, not project-scoped: the Codex CLI's own model catalog isn't
 * per-project. Mounted via the same `app.route("/", …)` pattern as every
 * other route, so it inherits the same CORS/loopback origin gate as the
 * rest of `/api/*` — no bespoke, more-permissive path.
 *
 * Two TTLs, not one:
 *  - `ttlMs` (default 5 min) — how long a SUCCESSFUL probe's result is
 *    served without re-probing.
 *  - `failureTtlMs` (default 30s) — how long a FAILED probe's outcome is
 *    remembered before the next request tries again. Without this, a
 *    persistently broken/hanging `codex` would pay a fresh multi-second
 *    probe timeout on every single request past a stale (or absent)
 *    success cache (external review + internal plan review finding,
 *    both independently, 2026-09-19).
 *
 * Always HTTP 200 — never blocks or fails the launch form for this reason.
 * `status: "ok"` (fresh probe or within `ttlMs`), `"stale"` (probe failed,
 * serving the last good list), `"unavailable"` (probe failed, no prior
 * cache — empty list). The client's free-text fallback works regardless.
 */

import { Hono } from "hono";

import { runCodexModelsProbe, type CodexModelCatalogEntry, type CodexModelsProbeResult } from "../core/codex-models-probe.js";

export interface CodexModelsResponse {
  status: "ok" | "stale" | "unavailable";
  models: CodexModelCatalogEntry[];
}

export function createCodexModelsRoutes(args: {
  /** Success-cache TTL; defaults to 5 minutes. Test seam. */
  ttlMs?: number;
  /** Failed-probe retry floor; defaults to 30s. Test seam. */
  failureTtlMs?: number;
  /** Probe override (test seam) — defaults to the real `codex debug models` probe. */
  probe?: () => Promise<CodexModelsProbeResult>;
}) {
  const app = new Hono();
  const ttlMs = args.ttlMs ?? 300_000;
  const failureTtlMs = args.failureTtlMs ?? 30_000;
  const probe = args.probe ?? (() => runCodexModelsProbe({}));

  let cache: { models: CodexModelCatalogEntry[]; at: number } | null = null;
  let lastFailureAt: number | null = null;
  let inflight: Promise<CodexModelsResponse> | null = null;

  app.get("/api/codex-models", async (c) => {
    const now = Date.now();
    if (cache !== null && now - cache.at <= ttlMs) {
      return c.json({ status: "ok", models: cache.models } satisfies CodexModelsResponse);
    }
    if (lastFailureAt !== null && now - lastFailureAt <= failureTtlMs) {
      return c.json(
        (cache !== null
          ? { status: "stale", models: cache.models }
          : { status: "unavailable", models: [] }) satisfies CodexModelsResponse,
      );
    }

    if (!inflight) {
      // `.catch()` before `.then()`'s degrade branch runs so a rejecting
      // `probe` (the shipped `runCodexModelsProbe` never rejects, but a
      // test/future override might) still resolves the route to the same
      // HTTP-200 stale/unavailable contract, never a 500 (external
      // code-review finding, 2026-09-19).
      inflight = probe()
        .catch(() => ({ ok: false, models: [] }) satisfies CodexModelsProbeResult)
        .then((result) => {
          if (result.ok) {
            cache = { models: result.models, at: Date.now() };
            lastFailureAt = null;
            return { status: "ok", models: result.models } satisfies CodexModelsResponse;
          }
          lastFailureAt = Date.now();
          return (
            cache !== null
              ? { status: "stale", models: cache.models }
              : { status: "unavailable", models: [] }
          ) satisfies CodexModelsResponse;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return c.json(await inflight);
  });

  return app;
}
