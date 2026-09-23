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

  let cache: { models: CodextenderModelEntry[]; at: number } | null = null;
  let lastFailureAt: number | null = null;
  let inflight: Promise<CodextenderModelsResponse> | null = null;

  app.get("/api/codextender-models", async (c) => {
    const now = Date.now();
    if (cache !== null && now - cache.at <= ttlMs) {
      return c.json({ status: "ok", models: cache.models } satisfies CodextenderModelsResponse);
    }
    if (lastFailureAt !== null && now - lastFailureAt <= failureTtlMs) {
      return c.json(
        (cache !== null
          ? { status: "stale", models: cache.models }
          : { status: "unavailable", models: [] }) satisfies CodextenderModelsResponse,
      );
    }

    if (!inflight) {
      inflight = (async () => {
        let port: number;
        try {
          port = await args.getPort();
        } catch {
          // A getPort() rejection (e.g. a settings-read fault) must degrade
          // the same as a probe failure, never escape as a 500 — this route
          // is documented as always-200.
          lastFailureAt = Date.now();
          return (
            cache !== null
              ? { status: "stale", models: cache.models }
              : { status: "unavailable", models: [] }
          ) satisfies CodextenderModelsResponse;
        }
        return probe(port)
          .catch(() => ({ ok: false, models: [] }) satisfies CodextenderProbeResult)
          .then((result) => {
            if (result.ok) {
              cache = { models: result.models, at: Date.now() };
              lastFailureAt = null;
              return { status: "ok", models: result.models } satisfies CodextenderModelsResponse;
            }
            lastFailureAt = Date.now();
            return (
              cache !== null
                ? { status: "stale", models: cache.models }
                : { status: "unavailable", models: [] }
            ) satisfies CodextenderModelsResponse;
          });
      })().finally(() => {
        inflight = null;
      });
    }
    return c.json(await inflight);
  });

  return app;
}
