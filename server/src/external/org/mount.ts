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
  /** FR-04.42 — task-title lookup for `GET /api/org/threads`. */
  store?: OrgApiRouterDeps["store"];
}

/** FR-04.38 — mounted only when `honoHost` + `leadsRoot` are both provided. */
export function mountOrgRouters(app: Hono, deps: MountOrgRoutersDeps): void {
  const { honoHost, leadsRoot, leadsRouteSecret, orgLstatSync, orgWithDecisionsLock, store } = deps;
  if (!honoHost || !leadsRoot) return;

  app.route(
    "/",
    createOrgRouter({
      honoHost,
      leadsRoot,
      leadsRouteSecret,
      lstatSync: orgLstatSync,
      withDecisionsLock: orgWithDecisionsLock,
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
    }),
  );
}
