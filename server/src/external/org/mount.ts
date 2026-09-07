/*
 * external/org/mount.ts — composes BOTH the secret-gated `/api/external/org/*`
 * family and the plain-surface `/api/org/*` proxy onto one parent Hono app.
 *
 * Split out of `external/routes.ts` (grandfathered at the 300-line bloat
 * ceiling — CLAUDE.md) purely to avoid ratcheting it; no behavior change.
 * Mounting both from one call site is NOT the "route-mount collision" the
 * iterate spec's Design Notes warn against — that note is about the new
 * router never calling a `registerXRoute` from this family (it doesn't;
 * `routes/org.ts` only imports the extracted pure cores). Which file issues
 * the two `app.route()` calls is unrelated to that guard.
 */

import type { Hono } from "hono";

import { createOrgRouter, type OrgRouterDeps } from "./routes.js";
import { createOrgApiRouter, type OrgApiRouterDeps } from "../../routes/org.js";

export interface MountOrgRoutersDeps {
  honoHost?: string;
  leadsRoot?: string;
  leadsRouteSecret?: string;
  orgLstatSync?: OrgRouterDeps["lstatSync"];
  orgWithDecisionsLock?: OrgRouterDeps["withDecisionsLock"];
  /** FR-04.42 task-title lookup for `GET /api/org/threads` AND (W14)
   *  `GET /api/external/org/domains`' task-domain aggregation — the real
   *  production value (`SdkSessionsStore`) satisfies both narrow shapes;
   *  intersected here rather than widened so each router still only
   *  declares the method it actually calls. */
  store?: OrgApiRouterDeps["store"] & OrgRouterDeps["store"];
  /** iterate-2026-09-07-leadwright-setup-wizard (W14) — passed through to
   *  the verdict/commit routes; unset ⇒ those two fail closed. */
  leadwrightCheckoutRoot?: string;
  webuiBaseUrl?: string;
}

/** FR-04.38 — mounted only when `honoHost` + `leadsRoot` are both provided. */
export function mountOrgRouters(app: Hono, deps: MountOrgRoutersDeps): void {
  const {
    honoHost,
    leadsRoot,
    leadsRouteSecret,
    orgLstatSync,
    orgWithDecisionsLock,
    store,
    leadwrightCheckoutRoot,
    webuiBaseUrl,
  } = deps;
  if (!honoHost || !leadsRoot) return;

  app.route(
    "/",
    createOrgRouter({
      honoHost,
      leadsRoot,
      leadsRouteSecret,
      lstatSync: orgLstatSync,
      withDecisionsLock: orgWithDecisionsLock,
      leadwrightCheckoutRoot,
      webuiBaseUrl: webuiBaseUrl ?? "http://localhost:5173",
      store,
    }),
  );
  app.route(
    "/",
    createOrgApiRouter({
      honoHost,
      leadsRoot,
      lstatSync: orgLstatSync,
      withDecisionsLock: orgWithDecisionsLock,
      store,
      leadwrightCheckoutRoot,
      webuiBaseUrl,
    }),
  );
}
