/**
 * version-check.mjs — AC6, the npx-cache "stale copy" self-check.
 *
 * A plain `npx <pkg>` can silently reuse a CACHED OLD version and the user
 * never knows they ran yesterday's build. Two mitigations (both required, the
 * second lives here): every printed command says `@latest`, AND on start we
 * ask the registry what `latest` is and warn when we are behind.
 *
 * Hard rule: this is a courtesy, never a gate. Offline, a slow registry, a
 * 500, a garbled body — all degrade to "no banner, keep going". A machine with
 * no internet must still be able to boot the Command Center against its cache.
 */

import { compareSemver } from "./util.mjs";

const REGISTRY_URL = "https://registry.npmjs.org/@svenroth-ai/shipwright/latest";
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Fetch the registry's `latest` version. Never throws — resolves to `null` on
 * any failure (offline, timeout, non-200, non-JSON, missing field).
 * @param {{ fetchImpl?: typeof fetch, url?: string, timeoutMs?: number }} [deps]
 * @returns {Promise<string | null>}
 */
export async function fetchLatestVersion(deps = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    url = REGISTRY_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = deps;
  if (!fetchImpl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const v = body && typeof body.version === "string" ? body.version : null;
    return v && /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether a stale-copy banner should show.
 * @param {string} selfVersion  this package's own version
 * @param {string | null} latest  the registry's `latest` (null = unknown)
 * @returns {{ stale: boolean, selfVersion: string, latest: string | null }}
 */
export function evaluateStaleness(selfVersion, latest) {
  const stale = latest != null && compareSemver(selfVersion, latest) < 0;
  return { stale, selfVersion, latest };
}

/**
 * Full self-check: fetch latest, compare, return a verdict. Offline-safe.
 * @param {string} selfVersion
 * @param {{ fetchImpl?: typeof fetch, url?: string, timeoutMs?: number }} [deps]
 */
export async function checkForStaleCopy(selfVersion, deps = {}) {
  const latest = await fetchLatestVersion(deps);
  return evaluateStaleness(selfVersion, latest);
}

/** Human line for a stale verdict, or `null` when up to date / unknown. */
export function staleBanner(verdict) {
  if (!verdict.stale) return null;
  return (
    `You are running a stale cached copy (${verdict.selfVersion}); ` +
    `${verdict.latest} is available. Re-run with:\n` +
    `  npx @svenroth-ai/shipwright@latest`
  );
}
