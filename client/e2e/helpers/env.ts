/*
 * Single source for every environment-dependent value in the E2E suite.
 * iterate-2026-07-10-harness-hardening (campaign A00).
 *
 * BEFORE: 17 specs hardcoded a host:port literal (`http://localhost:3847`
 * ×23, plus strays on :5173 / :3000 / :4847 / :3863). The suite was welded to
 * one developer's machine and produced 36 deterministic environment failures
 * on any alt-port stack. Every such literal now routes through here.
 *
 * ── Why API_BASE defaults to the APP origin, not to :3847 ────────────────────
 * The application never talks to :3847 directly. It talks to its OWN origin and
 * the Vite dev server proxies `/api` (and the WS upgrade) through to Hono — see
 * `client/vite.config.ts`, whose proxy target follows `PORT`. In the F0.5
 * single-process isolated stack there is no Vite at all: the built client is
 * served by Hono itself (`SHIPWRIGHT_STATIC_DIR`), so app and API are literally
 * the same origin.
 *
 * Deriving API_BASE from the app origin is therefore both simpler AND more
 * faithful than pinning a backend port: a spec exercises the same path the
 * browser does. `API_BASE_URL` stays available as an explicit override for the
 * rare spec that must bypass the proxy and address Hono directly (CORS /
 * WS-origin assertions).
 *
 * ── Why IPv4 literals, never `localhost` ─────────────────────────────────────
 * Node resolves `localhost` to `::1` first, while the Hono bind is v4 — a trap
 * this repo has hit repeatedly (see the F0.5 isolated-stack notes). Defaults are
 * pinned to `127.0.0.1` so a spec cannot fail on name resolution alone.
 */

/** Strip trailing slashes so `${BASE}/api/...` never doubles up. */
function normalizeBase(raw: string): string {
  return raw.replace(/\/+$/, "");
}

const DEFAULT_APP_BASE = "http://127.0.0.1:5173";

/**
 * Origin the browser loads the app from. `BASE_URL` is the same env var
 * `playwright.config.ts` feeds into `use.baseURL`, so page-relative
 * `page.goto("/")` and these helpers always agree.
 */
export const APP_BASE = normalizeBase(process.env.BASE_URL || DEFAULT_APP_BASE);

/**
 * Origin the REST API answers on. Same-origin as the app by default (see the
 * header note); `API_BASE_URL` overrides for direct-to-Hono specs.
 */
export const API_BASE = normalizeBase(process.env.API_BASE_URL || APP_BASE);

/** WebSocket origin, derived from API_BASE (`http`→`ws`, `https`→`wss`). */
export const WS_BASE = API_BASE.replace(/^http/, "ws");

/**
 * Sentinel the isolated recipe exports (mirrors
 * `helpers/isolated-store.ts` ISOLATION_SENTINEL_ENV). True when the suite runs
 * against a throwaway temp-USERPROFILE stack rather than a developer's machine.
 */
export const IS_ISOLATED = process.env.SHIPWRIGHT_E2E_ISOLATED === "1";

/** Absolute API URL. `path` may be given with or without a leading slash. */
export function apiUrl(path: string): string {
  return `${API_BASE}/${path.replace(/^\/+/, "")}`;
}

/** Absolute WS URL. `path` may be given with or without a leading slash. */
export function wsUrl(path: string): string {
  return `${WS_BASE}/${path.replace(/^\/+/, "")}`;
}

/** Absolute app URL — for the rare spec that needs one (most use `page.goto("/")`). */
export function appUrl(path: string): string {
  return `${APP_BASE}/${path.replace(/^\/+/, "")}`;
}

/** WS URL of a task's terminal socket — the one WS shape the suite cares about. */
export function terminalWsUrl(taskId: string): string {
  return wsUrl(`api/terminal/${encodeURIComponent(taskId)}/ws`);
}
