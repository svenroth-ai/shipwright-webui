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
 *    `Authorization: Bearer <CODEXTENDER_AUTH_TOKEN_PLACEHOLDER>` — the
 *    proxy's own `config.py` sets `general_settings.master_key` to that
 *    same fixed value, and confirmed live against a real local LiteLLM
 *    proxy: an unauthenticated `/v1/models` request returns `500` (a
 *    LiteLLM quirk, not a clean 401), so omitting the header makes every
 *    probe look like a hard failure. Backs the cached
 *    `/api/codextender-models` route (`routes/codextender-models.ts`),
 *    which wraps this probe in a TTL cache mirroring `codex-models.ts`'s
 *    shape.
 *
 * Deliberately no CLI shell-out (unlike `codex-models-probe.ts`) — the
 * proxy already speaks these two endpoints natively (LiteLLM's own
 * built-in routes), so plain HTTP GETs are both the cheapest check and the
 * datalist's real source.
 */

import { CODEXTENDER_AUTH_TOKEN_PLACEHOLDER } from "./launcher-codextender.js";

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
}

/**
 * `GET http://127.0.0.1:<port>/v1/models` with the fixed Codextender
 * master-key bearer token. Never throws — any network error, non-2xx
 * status, timeout, or malformed body resolves `{ok: false, models: []}`
 * rather than rejecting, so callers never need a try/catch.
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
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 1500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/v1/models`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${CODEXTENDER_AUTH_TOKEN_PLACEHOLDER}` },
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
