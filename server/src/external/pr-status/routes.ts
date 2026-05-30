/*
 * external/pr-status/routes.ts — GET /api/external/pr-status?url=<prUrl>.
 *
 * Surfaces a GitHub PR's open/merged state for the transcript PrLinkCard
 * (iterate-2026-05-30-pr-card-status). The url is validated as a
 * github.com pull URL BEFORE any gh invocation (AC4); the gh call itself
 * runs shell:false in core/pr-status.ts (AC3). Failure modes degrade to
 * { state: "unknown" } there, so this route only 400s on a bad url and
 * otherwise always returns 200 with a PrStatus body.
 */

import { Hono } from "hono";

import {
  fetchPrStatus as defaultFetchPrStatus,
  validatePrUrl,
  type PrStatus,
} from "../../core/pr-status.js";

export interface PrStatusRouterDeps {
  fetchPrStatus?: typeof defaultFetchPrStatus;
}

export function createPrStatusRouter(deps: PrStatusRouterDeps = {}): Hono {
  const app = new Hono();
  const fetchStatus = deps.fetchPrStatus ?? defaultFetchPrStatus;

  app.get("/api/external/pr-status", async (c) => {
    const url = c.req.query("url") ?? "";
    if (!validatePrUrl(url)) {
      return c.json(
        {
          error:
            "invalid or missing url (expected https://github.com/<owner>/<repo>/pull/<n>)",
        },
        400,
      );
    }
    // fetchPrStatus is contracted never to reject (every failure → unknown),
    // but degrade defensively even if that contract is ever violated: the
    // transcript badge must never surface a 500.
    let status: PrStatus;
    try {
      status = await fetchStatus(url);
    } catch {
      status = { state: "unknown", merged: false };
    }
    return c.json(status);
  });

  return app;
}
