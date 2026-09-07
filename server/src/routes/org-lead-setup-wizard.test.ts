/*
 * org-lead-setup-wizard.test.ts — the plain-surface `/api/org/*` mirror of
 * the verdict/commit/domains routes actually reaches the shared cores
 * (iterate-2026-09-07-leadwright-setup-wizard, W14). Full behavior is
 * covered by verdict.test.ts / commit.test.ts / domains.test.ts against
 * the pure cores directly — this file only proves the wiring.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { registerLeadSetupWizardRoutes } from "./org-lead-setup-wizard.js";

describe("plain-surface /api/org/* lead-setup-wizard routes", () => {
  it("GET /api/org/domains reaches domainsCore (200, empty vocabulary with no org-chart.json)", async () => {
    const app = new Hono();
    registerLeadSetupWizardRoutes(app, {
      leadsRoot: "/nonexistent-leads-root",
      leadwrightCheckoutRoot: undefined,
      webuiBaseUrl: "http://localhost:5173",
    });
    const res = await app.request("/api/org/domains");
    expect(res.status).toBe(404); // org-chart.json missing at that root
  });

  it("POST /api/org/leads/verdict 503s leadwright_not_configured when unset (no secret required)", async () => {
    const app = new Hono();
    registerLeadSetupWizardRoutes(app, {
      leadsRoot: "/leads",
      leadwrightCheckoutRoot: undefined,
      webuiBaseUrl: "http://localhost:5173",
    });
    const res = await app.request("/api/org/leads/verdict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "leadwright_not_configured" });
  });

  it("POST /api/org/leads/commit 503s leadwright_not_configured when unset (no secret required)", async () => {
    const app = new Hono();
    registerLeadSetupWizardRoutes(app, {
      leadsRoot: "/leads",
      leadwrightCheckoutRoot: undefined,
      webuiBaseUrl: "http://localhost:5173",
    });
    const res = await app.request("/api/org/leads/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "leadwright_not_configured" });
  });
});
