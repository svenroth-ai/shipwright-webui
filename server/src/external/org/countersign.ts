/*
 * external/org/countersign.ts — POST /api/external/org/decisions/countersign.
 *
 * Hono route shell only — parses the request and hands off to
 * `handleCountersignRequest` (`countersign-request.ts`), which is ALSO used
 * by the plain browser-facing proxy's countersign route (`routes/org.ts`,
 * iterate-2026-09-06-decisions-proposed-countersign) so the two route shells
 * cannot drift on validation or status-mapping. The countersign action
 * itself (locking, decision-log/proposed-file mutation) lives in
 * `countersign-core.ts`.
 */

import type { Hono } from "hono";

import { handleCountersignRequest } from "./countersign-request.js";
import type { CountersignCoreDeps } from "./countersign-core.js";

export { performCountersign } from "./countersign-core.js";
export type { CountersignOutcome, CountersignCoreDeps } from "./countersign-core.js";
export { handleCountersignRequest } from "./countersign-request.js";
export type {
  HandleCountersignRequestDeps,
  CountersignRequestResult,
} from "./countersign-request.js";

export type CountersignRouteDeps = CountersignCoreDeps;

export function registerCountersignRoute(app: Hono, deps: CountersignRouteDeps): void {
  app.post("/api/external/org/decisions/countersign", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const result = await handleCountersignRequest(deps, body);
    return c.json(result.body, result.status);
  });
}
