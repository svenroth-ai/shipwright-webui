/*
 * org-inventory.test.ts — GET /api/org/inventory
 * (iterate-2026-09-08-lead-inventory-page). Same fixture pattern
 * (`org-chart.json` in a temp `leadsRoot`) as `org-threads.test.ts` — the
 * window/ordering/degrade logic itself is covered by
 * `org-inventory-composite.test.ts`; this file proves the route is wired
 * and returns the composite shape end to end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

const VALID_BEAT_ID = "9f1c9e2a-2b1e-4a1e-9c1e-1a2b3c4d5e6f";

const CHART = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme-lead",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "charter.md",
    },
  },
};

describe("GET /api/org/inventory", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-inventory-route-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  function writeChart() {
    writeFileSync(path.join(leadsRoot, "org-chart.json"), JSON.stringify(CHART), "utf8");
  }

  it("forwards the org-chart error when the chart itself is missing", async () => {
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/inventory");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("org_chart_missing");
  });

  it("returns a zero-beat entry for a lead with no register file — the steady state, not an error", async () => {
    writeChart();
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["acme-lead"].totalBeatsInRegister).toBe(0);
    expect(body["acme-lead"].beats).toEqual([]);
    expect(body["acme-lead"].authority).toEqual({ measured: false, reason: "not readable at the default charter path" });
  });

  it("renders a beat's steps and band chips, and the authority panel from a real charter.md (AC-1)", async () => {
    writeChart();
    mkdirSync(path.join(leadsRoot, "acme-lead", "beats", VALID_BEAT_ID), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId: "s1",
            beatId: VALID_BEAT_ID,
            leadId: "acme-lead",
            pid: 123,
            startedAt: new Date().toISOString(),
            closedAt: null,
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beats", VALID_BEAT_ID, "steps.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), band: "bugfix", summary: "fixed a typo", effect: { kind: "none" } })}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "charter.md"),
      "## Bugfix / bekannter Defekt\nFix small defects.\n\n## Kleine Pflege\nUpkeep.\n\n## Neues Feature\nAsk first.\n\n## Architektur / Grundsatz\nAsk first.\n",
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    const lead = body["acme-lead"];
    expect(lead.beats).toHaveLength(1);
    expect(lead.beats[0].steps).toEqual({
      status: "ok",
      steps: [{ at: expect.any(String), band: "bugfix", summary: "fixed a typo", effect: { kind: "none" } }],
      unreadableLines: 0,
    });
    expect(lead.beats[0].unclaimedEffect).toEqual({ status: "clear" });
    expect(lead.authority.measured).toBe(true);
    expect(lead.authority.declaredCount).toBe(4);
  });

  it("renders a visible unclaimed-effect warning on the matching beat (AC-2a)", async () => {
    writeChart();
    mkdirSync(path.join(leadsRoot, "acme-lead", "beats", VALID_BEAT_ID), { recursive: true });
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId: "s1",
            beatId: VALID_BEAT_ID,
            leadId: "acme-lead",
            pid: 123,
            startedAt: new Date().toISOString(),
            closedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadsRoot, "acme-lead", "audit.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString(), kind: "beat_effect_not_claimed", lead_id: "acme-lead", beat_id: VALID_BEAT_ID })}\n`,
      "utf8",
    );
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const res = await app.request("/api/org/inventory");
    const body = await res.json();
    expect(body["acme-lead"].beats[0].unclaimedEffect).toEqual({ status: "found" });
  });
});
