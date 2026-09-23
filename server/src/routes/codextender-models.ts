/*
 * GET /api/codextender-models — the Codextender proxy's live model-catalog
 * endpoint (Codextender integration spec Part B.5, mid-run user
 * clarification, 2026-09-23).
 *
 * Mirrors `routes/codex-models.ts`'s TTL-cache + inflight-coalescing shape
 * exactly, as a SEPARATE cache instance (a Codextender-mode operator's
 * proxy is a live local process they start/stop themselves — its own
 * freshness window has nothing to do with Codex Light's `codex debug
 * models` cache). Always HTTP 200 — never blocks or fails the New Iterate
 * form for this reason; the client's free-text input works regardless.
 */

import { Hono } from "hono";

import {
  probeCodextenderModels,
  type CodextenderModelEntry,
  type CodextenderProbeResult,
} from "../core/codextender-proxy-probe.js";

export interface CodextenderModelsResponse {
  status: "ok" | "stale" | "unavailable";
  models: CodextenderModelEntry[];
}

export function createCodextenderModelsRoutes(args: {
  /** Resolves the CURRENT `codextenderPort` setting at request time (not
   *  cached — a port change should take effect on the next probe). */
  getPort: () => Promise<number>;
  ttlMs?: number;
  failureTtlMs?: number;
  /** Probe override (test seam) — defaults to the real proxy probe. */
  probe?: (port: number) => Promise<CodextenderProbeResult>;
}) {
  const app = new Hono();
  const ttlMs = args.ttlMs ?? 300_000;
  const failureTtlMs = args.failureTtlMs ?? 30_000;
  const probe = args.probe ?? probeCodextenderModels;

  // Keyed by port (PR-review BLOCK fix, iterate-2026-09-23 fourth round):
  // the cache/failure state must be scoped to the port it was fetched
  // against, or changing `codextenderPort` in Settings would keep serving
  // the PREVIOUS proxy's model list for up to `ttlMs`.
  let cache: { port: number; models: CodextenderModelEntry[]; at: number } | null = null;
  let lastFailure: { port: number; at: number } | null = null;
  let inflight: { port: number; promise: Promise<CodextenderModelsResponse> } | null = null;

  app.get("/api/codextender-models", async (c) => {
    const now = Date.now();
    let port: number;
    try {
      port = await args.getPort();
    } catch {
      // A getPort() rejection (e.g. a settings-read fault) must degrade
      // the same as a probe failure, never escape as a 500 — this route
      // is documented as always-200.
      return c.json(
        (cache !== null
          ? { status: "stale", models: cache.models }
          : { status: "unavailable", models: [] }) satisfies CodextenderModelsResponse,
      );
    }

    if (cache !== null && cache.port === port && now - cache.at <= ttlMs) {
      return c.json({ status: "ok", models: cache.models } satisfies CodextenderModelsResponse);
    }
    if (lastFailure !== null && lastFailure.port === port && now - lastFailure.at <= failureTtlMs) {
      return c.json(
        (cache !== null && cache.port === port
          ? { status: "stale", models: cache.models }
          : { status: "unavailable", models: [] }) satisfies CodextenderModelsResponse,
      );
    }

    if (!inflight || inflight.port !== port) {
      inflight = {
        port,
        promise: probe(port)
          .catch(() => ({ ok: false, models: [] }) satisfies CodextenderProbeResult)
          .then((result) => {
            if (result.ok) {
              cache = { port, models: result.models, at: Date.now() };
              lastFailure = null;
              return { status: "ok", models: result.models } satisfies CodextenderModelsResponse;
            }
            lastFailure = { port, at: Date.now() };
            return (
              cache !== null && cache.port === port
                ? { status: "stale", models: cache.models }
                : { status: "unavailable", models: [] }
            ) satisfies CodextenderModelsResponse;
          })
          .finally(() => {
            inflight = null;
          }),
      };
    }
    return c.json(await inflight.promise);
  });

  return app;
}
