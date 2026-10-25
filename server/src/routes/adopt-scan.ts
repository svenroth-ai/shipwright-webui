/*
 * POST /api/adopt/scan  { path }  - read-only profile look for the Adopt screen
 * (`core/adopt-scan.ts`). Read outcomes are 200 with a discriminated `status`
 * (the client renders an honest line for each); only a malformed REQUEST is 4xx.
 * A JSON content-type is REQUIRED: a cross-site "simple" POST (text/plain form)
 * cannot set it without a CORS preflight, so a hostile page cannot make this
 * machine spawn the analyzer.
 */

import { Hono } from "hono";

import { scanRepoProfile, type AdoptScanDeps } from "../core/adopt-scan.js";

export function createAdoptScanRoutes(deps: AdoptScanDeps = {}): Hono {
  const app = new Hono();
  app.post("/api/adopt/scan", async (c) => {
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ status: "invalid-request", reason: "Expected a JSON body." }, 415);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ status: "invalid-request", reason: "Expected a JSON body." }, 400);
    }
    return c.json(await scanRepoProfile({ path: (body as Record<string, unknown>).path }, deps));
  });
  return app;
}
