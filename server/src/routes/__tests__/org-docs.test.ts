/*
 * org-docs.test.ts — split out of org.test.ts (which was at its 300-line
 * guideline) purely to stay under it. Covers the two new per-lead Docs-block
 * reads (`GET /api/org/leads/:leadId/learnings` and `.../audit`) — see
 * `lead-doc-read.ts` and `audit-log.ts` for why these are NOT part of the
 * six-target allowlist `org.test.ts`'s `GET /api/org/file` suite covers.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createOrgApiRouter } from "../org.js";

function seedChart(leadsRoot: string, leadId: string) {
  writeFileSync(
    path.join(leadsRoot, "org-chart.json"),
    JSON.stringify({
      version: 1,
      po: "sven",
      leads: {
        [leadId]: {
          domain: "acme",
          name: "Acme Lead",
          reports_to: null,
          manages: [],
          charter_path: `${leadId}/charter.md`,
        },
      },
    }),
    "utf8",
  );
}

describe("createOrgApiRouter — per-lead Docs-block reads", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-docs-fixture-"));
    // Code-review fix: the two routes covered here now refuse a
    // syntactically-valid but unregistered leadId (same posture as the
    // charter PUT route's `unknown_lead` fix) — every fixture below needs
    // its leadId registered in org-chart.json to reach the underlying read.
    seedChart(leadsRoot, "acme-lead");
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it("403s unknown_lead for a valid-shaped but unregistered leadId, on both routes", async () => {
    const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
    const learningsRes = await app.request("/api/org/leads/ghost-lead/learnings");
    expect(learningsRes.status).toBe(403);
    expect((await learningsRes.json()).error).toBe("unknown_lead");

    const auditRes = await app.request("/api/org/leads/ghost-lead/audit");
    expect(auditRes.status).toBe(403);
    expect((await auditRes.json()).error).toBe("unknown_lead");
  });

  describe("GET /api/org/leads/:leadId/learnings", () => {
    it("404s not_found when the lead has no learnings.md yet", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/learnings");
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("not_found");
    });

    it("serves the lead's learnings.md", async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(path.join(leadsRoot, "acme-lead", "learnings.md"), "learned things", "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/learnings");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("learned things");
    });

    it("400s an invalid leadId", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request(`/api/org/leads/${encodeURIComponent("../etc")}/learnings`);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/org/leads/:leadId/audit — bounded/paginated", () => {
    it("404s not_found when the lead has no audit.jsonl yet", async () => {
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/audit");
      expect(res.status).toBe(404);
    });

    it("returns the newest entries first, capped at `limit`, with a nextCursor for older ones", async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ seq: i })).join("\n");
      writeFileSync(path.join(leadsRoot, "acme-lead", "audit.jsonl"), lines + "\n", "utf8");

      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/audit?limit=2");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toHaveLength(2);
      expect(body.entries[0].parsed).toEqual({ seq: 4 }); // newest first
      expect(body.entries[1].parsed).toEqual({ seq: 3 });
      expect(body.total).toBe(5);
      expect(body.nextCursor).toBe(2);

      const page2 = await app.request(`/api/org/leads/acme-lead/audit?limit=2&before=${body.nextCursor}`);
      const body2 = await page2.json();
      expect(body2.entries.map((e: { parsed: { seq: number } }) => e.parsed.seq)).toEqual([2, 1]);
      expect(body2.nextCursor).toBe(4);
    });

    it("keeps a malformed line as raw with parsed:null rather than failing the whole page", async () => {
      mkdirSync(path.join(leadsRoot, "acme-lead"), { recursive: true });
      writeFileSync(path.join(leadsRoot, "acme-lead", "audit.jsonl"), "{not json\n", "utf8");
      const app = createOrgApiRouter({ leadsRoot, honoHost: "127.0.0.1" });
      const res = await app.request("/api/org/leads/acme-lead/audit");
      const body = await res.json();
      expect(body.entries[0]).toEqual({ raw: "{not json", parsed: null });
    });
  });
});
