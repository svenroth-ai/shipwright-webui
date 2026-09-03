import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { Hono } from "hono";

import { createOrgApiRouter } from "../org.js";
import { createOrgRouter } from "../../external/org/routes.js";

const CHART = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
    },
  },
};

// Split out of org.test.ts to keep both files under the 300-line
// convention — the "file GET" / "charter PUT" / mount-collision (AC-9)
// groups here, the org-chart + composite-roster reads in the sibling file.
describe("createOrgApiRouter — /api/org/* plain-surface proxy (file GET / charter PUT / mount)", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-api-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  describe("GET /api/org/file — read-only, unrestricted by kind", () => {
    it("serves an allowlisted shared doc (conventions.md)", async () => {
      writeFileSync(path.join(leadsRoot, "conventions.md"), "# Conventions\n", "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/file?path=conventions.md");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("# Conventions\n");
      expect(res.headers.get("etag")).toBeTruthy();
    });

    it("serves a lead's own charter.md (fresh-load-before-edit round trip)", async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(path.join(leadsRoot, "acme-lead", "charter.md"), "charter body", "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request(
        `/api/org/file?path=${encodeURIComponent("acme-lead/charter.md")}`,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("charter body");
    });

    it("a not-yet-bootstrapped allowlisted target 404s not_found (open-before-realpath ordering — the shared-doc viewer's not-found state)", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/file?path=conventions.md");
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("not_found");
    });

    it("403s a non-allowlisted path", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/file?path=random-file.md");
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/org/leads/:leadId/charter — AC-10", () => {
    it("refuses a write when the resolved kind is not charter (decision_log is unreachable via leadId)", async () => {
      // leadId containing a slash cannot resolve to a charter path at all —
      // resolveOrgAllowlistedTarget rejects it before `kind` is even checked.
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request(
        `/api/org/leads/${encodeURIComponent("../decision_log")}/charter`,
        { method: "PUT", body: "x", headers: { "if-match": '"abc"' } },
      );
      expect([400, 403]).toContain(res.status);
    });

    it("writes charter.md successfully with a matching If-Match", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      const target = path.join(leadsRoot, "acme-lead", "charter.md");
      writeFileSync(target, "old content", "utf8");
      const { fileFingerprint } = await import("../../external/file/_helpers.js");
      const fp = fileFingerprint(Buffer.from("old content", "utf8"));

      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/charter", {
        method: "PUT",
        body: "new content",
        headers: { "if-match": `"${fp}"` },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).written).toBe(true);
    });

    it("409s on a stale If-Match fingerprint", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(path.join(leadsRoot, "acme-lead", "charter.md"), "content", "utf8");

      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/charter", {
        method: "PUT",
        body: "new content",
        headers: { "if-match": '"stale"' },
      });
      expect(res.status).toBe(409);
    });

    // External-review fix (HIGH, security): a syntactically valid leadId
    // that is NOT a registered chart entry must never reach the write
    // core — see routes/org.ts's `Object.hasOwn(chart.body.leads, leadId)`
    // guard.
    it("refuses a write for a valid-shaped but unregistered leadId (unknown_lead)", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");

      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/ghost-lead/charter", {
        method: "PUT",
        body: "x",
        headers: { "if-match": '"abc"' },
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("unknown_lead");
    });

    // Doubt-review fix (HIGH, security): a URL-encoded trailing slash
    // (`%2f`) survives Hono's route-param decode as a literal "/" — the raw
    // leadId becomes "ghost-lead/", which `resolveOrgAllowlistedTarget`
    // used to normalize away (path.resolve collapses the extra slash) while
    // `requireChartLead` deferred on the same string failing `LEAD_ID_RE`,
    // skipping the chart-membership check entirely. Seed an on-disk
    // "ghost-lead" directory (the decommissioned-lead scenario) so a passing
    // write would be observable, not just a 404-from-missing-file coincidence.
    it("refuses a write for a %2f-suffixed leadId even when a same-named orphaned directory exists on disk (bypass fix)", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
      mkdirSync(path.join(leadsRoot, "ghost-lead"), { recursive: true });
      writeFileSync(path.join(leadsRoot, "ghost-lead", "charter.md"), "orphaned content", "utf8");

      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/ghost-lead%2f/charter", {
        method: "PUT",
        body: "hijacked",
        headers: { "if-match": '"abc"' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_lead_id");
    });

    it("forwards the org-chart's own error when the chart is missing/invalid, rather than writing blind", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/charter", {
        method: "PUT",
        body: "x",
        headers: { "if-match": '"abc"' },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("org_chart_missing");
    });
  });

  describe("AC-9 — the existing secret-gated family is unaffected by mounting the new router", () => {
    it("GET /api/external/org/org-chart without the secret header still 401s, and /api/org/org-chart works, on ONE app with both mounted", async () => {
      writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");

      // Mirrors index.ts: both routers mounted at "/" on the same parent app
      // — the regression this guards against is one registration shadowing
      // the other (Design Notes, "No route-mount collision").
      const app = new Hono();
      app.route(
        "/",
        createOrgRouter({ leadsRoot, honoHost: "127.0.0.1", leadsRouteSecret: "s3cr3t" }),
      );
      app.route("/", createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" }));

      const gatedRes = await app.request("/api/external/org/org-chart");
      expect(gatedRes.status).toBe(401);
      expect((await gatedRes.json()).error).toBe("invalid_secret");

      const plainRes = await app.request("/api/org/org-chart");
      expect(plainRes.status).toBe(200);
      expect(await plainRes.json()).toEqual(CHART);
    });
  });
});
