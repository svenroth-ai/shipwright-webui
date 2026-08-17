/*
 * external/org/routes.ts — registration shell for `/api/external/org/*`
 * (FR-04.38, iterate-2026-08-17-org-route-leads).
 *
 * Every route in this family sits behind the SAME two gates, applied once
 * as router-level middleware (never re-checked per handler):
 *
 *   1. Host-bind allowlist — `honoHost` is a PLAIN STRING DEPENDENCY here,
 *      never `resolveHonoHost` called again. `index.ts` computes it exactly
 *      once (hoisted above BOTH the `createExternalRoutes(...)` call and
 *      the `serve(...)` call) and passes the same value to both — the
 *      structural guarantee plan review asked for in place of a brittle
 *      call-count spy.
 *   2. Shared secret — `X-Shipwright-Leads-Secret`, constant-time compare.
 *
 * Status-code contract (plan-review reconciliation — the mini-plan's prose
 * briefly drifted from the spec; this is the single source of truth):
 *   403 host_not_allowed     — resolved bind host outside the allowlist
 *   503 leads_route_not_configured — no secret configured on the server
 *   401 invalid_secret       — secret configured, header missing/wrong
 *
 * Doubt-review rebuttal (LOW-MEDIUM, no per-attempt rate limiting / no
 * enforced secret minimum length): deliberately NOT added. This family's
 * only trust boundary beyond the secret is the host allowlist itself
 * (loopback or this machine's OWN Tailscale tailnet, decided PO 2026-08-16)
 * — unlike a public API, an attacker already needs a foothold on the
 * operator's tailnet or local machine before a guessed secret matters at
 * all, and at that point rate-limiting a single-operator local tool adds
 * state (counters, a clock, a ban-list — all multi-writer-file problems of
 * their own) for a threat model this route doesn't have. The one cheap,
 * genuinely load-bearing piece — flagging a WEAK configured secret to the
 * operator — is added below as a boot-time warning, matching the
 * established pattern of the Preview coherence check (CLAUDE.md
 * "Preview-capability precedence"): warn, don't hard-fail, since a startup
 * validation error on a locally-generated secret is a worse availability
 * failure than a weak one.
 */

import { Hono } from "hono";

import { isAllowedOrgRouteHost, checkOrgSecret } from "./_helpers.js";
import { registerOrgFileRead } from "./file-read.js";
import { registerOrgFileWrite, type OrgFileWriteDeps } from "./file-write.js";
import { registerOrgChartRoute } from "./org-chart.js";
import { registerUsageRoute } from "./usage.js";
import { registerCountersignRoute } from "./countersign.js";

const SECRET_HEADER = "x-shipwright-leads-secret";
const MIN_SECRET_LENGTH = 20;

export interface OrgRouterDeps {
  leadsRoot: string;
  /** The application's resolved bind host — passed through, never re-derived. */
  honoHost: string;
  leadsRouteSecret: string | undefined;
  lstatSync?: OrgFileWriteDeps["lstatSync"];
  withDecisionsLock?: OrgFileWriteDeps["withDecisionsLock"];
}

export function createOrgRouter(deps: OrgRouterDeps): Hono {
  const app = new Hono();
  const { honoHost, leadsRouteSecret } = deps;

  if (leadsRouteSecret !== undefined && leadsRouteSecret.length < MIN_SECRET_LENGTH) {
    console.warn(
      JSON.stringify({
        level: "warn",
        error: "leads_route_secret_weak",
        detail: `SHIPWRIGHT_LEADS_ROUTE_SECRET is shorter than ${MIN_SECRET_LENGTH} chars — consider a longer generated value`,
      }),
    );
  }

  app.use("/api/external/org/*", async (c, next) => {
    if (!isAllowedOrgRouteHost(honoHost)) {
      return c.json({ error: "host_not_allowed" }, 403);
    }
    const check = checkOrgSecret(leadsRouteSecret, c.req.header(SECRET_HEADER));
    if (check === "not_configured") {
      return c.json({ error: "leads_route_not_configured" }, 503);
    }
    if (check === "invalid") {
      return c.json({ error: "invalid_secret" }, 401);
    }
    await next();
  });

  registerOrgFileRead(app, { leadsRoot: deps.leadsRoot });
  registerOrgFileWrite(app, {
    leadsRoot: deps.leadsRoot,
    lstatSync: deps.lstatSync,
    withDecisionsLock: deps.withDecisionsLock,
  });
  registerOrgChartRoute(app, { leadsRoot: deps.leadsRoot, lstatSync: deps.lstatSync });
  registerUsageRoute(app, { leadsRoot: deps.leadsRoot });
  registerCountersignRoute(app, {
    leadsRoot: deps.leadsRoot,
    lstatSync: deps.lstatSync,
  });

  return app;
}
