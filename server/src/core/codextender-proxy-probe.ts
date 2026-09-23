/*
 * codextender-proxy-probe — HTTP probes of the local Codextender (LiteLLM)
 * proxy (Codextender integration spec Part B.3/B.5, re-verified live
 * 2026-09-23).
 *
 * Two distinct endpoints, deliberately not collapsed into one probe:
 *  - `probeCodextenderLiveness` -> `GET /health/liveliness`, no auth
 *    header. This is the AC8 pre-flight check (`runtime-chokepoint.ts`'s
 *    `checkCodextenderProxyAvailable` default, and its fork-route
 *    equivalent in `external/tasks/fork.ts`) — a launch/fork only needs to
 *    know the proxy is UP, not what it serves.
 *  - `probeCodextenderModels` -> `GET /v1/models`, WITH
 *    `Authorization: Bearer <token>` where `<token>` comes from
 *    `process.env.CODEXTENDER_AUTH_TOKEN` (`resolveCodextenderAuthToken()`
 *    in `launcher-codextender.ts` — no built-in default, PR-review BLOCK,
 *    iterate-2026-09-23) — an unconfigured token degrades this probe to
 *    `{ok: false}` the same as an unreachable proxy, rather than sending a
 *    baked-in value. Confirmed live against a real local LiteLLM proxy: an
 *    unauthenticated `/v1/models` request returns `500` (a LiteLLM quirk,
 *    not a clean 401), so omitting the header makes every probe look like
 *    a hard failure regardless. Backs the cached `/api/codextender-models`
 *    route (`routes/codextender-models.ts`), which wraps this probe in a
 *    TTL cache mirroring `codex-models.ts`'s shape.
 *
 * Deliberately no CLI shell-out (unlike `codex-models-probe.ts`) — the
 * proxy already speaks these two endpoints natively (LiteLLM's own
 * built-in routes), so plain HTTP GETs are both the cheapest check and the
 * datalist's real source.
 */

import { resolveCodextenderAuthToken } from "./launcher-codextender.js";

export interface CodextenderModelEntry {
  slug: string;
  display_name: string;
}

export interface CodextenderProbeResult {
  ok: boolean;
  models: CodextenderModelEntry[];
}

export interface CodextenderProbeDeps {
  /** Test seam — defaults to the real global `fetch`. */
  fetchFn?: typeof fetch;
  /** Probe timeout in ms. Default 1500 — short enough that a launch or a
   *  datalist render never feels stuck on an unreachable proxy. */
  timeoutMs?: number;
  /** Test seam — defaults to `resolveCodextenderAuthToken()` (reads
   *  `process.env.CODEXTENDER_AUTH_TOKEN`, no built-in fallback). */
  authToken?: string;
}

/**
 * `GET http://127.0.0.1:<port>/v1/models` with the configured Codextender
 * master-key bearer token (`deps.authToken` or `resolveCodextenderAuthToken()`).
 * Never throws — an unconfigured token, any network error, non-2xx status,
 * timeout, or malformed body all resolve `{ok: false, models: []}` rather
 * than rejecting, so callers never need a try/catch.
 *
 * LiteLLM's `/v1/models` response is OpenAI-shaped (`{"data": [{"id":
 * "sol"}, ...]}`) — it carries no separate display name, so `display_name`
 * is set to the same slug (matches `codex-models-probe.ts`'s
 * `CodexModelCatalogEntry` shape for the client's shared consumer).
 */
export async function probeCodextenderModels(
  port: number,
  deps: CodextenderProbeDeps = {},
): Promise<CodextenderProbeResult> {
  const authToken = deps.authToken ?? resolveCodextenderAuthToken();
  if (!authToken) return { ok: false, models: [] };
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 1500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/v1/models`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return { ok: false, models: [] };
    const body: unknown = await res.json();
    const rawModels = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(rawModels)) return { ok: false, models: [] };
    const models: CodextenderModelEntry[] = [];
    for (const entry of rawModels) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as Record<string, unknown>).id;
      if (typeof id !== "string" || id.trim() === "") continue;
      models.push({ slug: id, display_name: id });
    }
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET http://127.0.0.1:<port>/health/liveliness` — no auth header
 * required (confirmed live against a real local LiteLLM proxy). This is
 * the AC8 pre-flight probe: it only needs to know the proxy process is up
 * and answering, not what it serves. Never throws — same
 * never-reject contract as `probeCodextenderModels`.
 */
export async function probeCodextenderLiveness(
  port: number,
  deps: CodextenderProbeDeps = {},
): Promise<boolean> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 1500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/health/liveliness`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
