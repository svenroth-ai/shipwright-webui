import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { handleCountersignRequest } from "../countersign-request.js";
import { handleRejectRequest } from "../reject-request.js";

// The countersign half of the decisions-rejected split (decisions-rejected.test.ts holds the reject half).
const TS = "2026-11-20T09:15:00.000Z";
const TS2 = "2026-11-20T10:30:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const LINE = "Status updates go out as one weekly digest instead of per-task messages.";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const NOW = "2026-11-28T10:00:00.000Z";
const QUOTE = "> The customer wrote that every single update should arrive in one combined mail — acme:2026-11-19T16:02:11Z:14";
const AUTHOR = "operator-x";

function daemonEntry(ts: string, key: string, line = LINE, quote: string | null = null): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${line}\n${quote === null ? "" : `${quote}\n`}` +
    `⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14\n`
  );
}
const webuiEntry = (ts: string, body: string) => `## [${ts}] ${LEAD}\n\n${body}\n`;

describe("countersign note (iterate-2026-11-28-decision-reject-reason)", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-rejected-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const countersign = (body: Record<string, unknown>) =>
    handleCountersignRequest({ leadsRoot: root, author: AUTHOR, now: () => new Date(NOW) }, { timestamp: TS, leadId: LEAD, ...body });
  const auditLines = () => (existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  describe("note item in the decisions log", () => {
    // @covers FR-01.71
    it("is logged as its own item below the line; without a note the block is unchanged", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY) + daemonEntry(TS2, "keep-reviews", "Keep reviews weekly."));
      expect((await countersign({ note: " ship it\nafter the review " })).status).toBe(200);
      expect((await handleCountersignRequest({ leadsRoot: root, author: AUTHOR }, { timestamp: TS2, leadId: LEAD })).status).toBe(200);
      const log = read(logged)!;
      expect(log).toMatch(new RegExp(`## ADR-0001 \\[${TS}\\] ${LEAD}\\n<!-- decisionKey: ${KEY} -->\\n<!-- proposal: [0-9a-f]{32} -->\\n\\n- ${LINE}\\n- Note: ship it after the review\\n\\n`));
      expect(log).toMatch(/## ADR-0002 [^\n]+\n<!-- decisionKey: keep-reviews -->\n<!-- proposal: [0-9a-f]{32} -->\n\n- Keep reviews weekly\.\n\n$/);
    });

    // @covers FR-01.71
    it("crash residue of a noted line block still heals as the same proposal", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      await countersign({ note: "ok" });
      writeFileSync(proposed, daemonEntry(TS, KEY)); // the removal "did not happen"
      const res = await countersign({ note: "a different note" });
      expect(res.body).toMatchObject({ countersigned: true, alreadyCountersigned: true, adr: "ADR-0001" });
      expect(read(proposed)).not.toContain(KEY);
      expect(read(logged)!.match(/- Note:/g)).toHaveLength(1);
    });

    // @covers FR-01.71
    it("a noted line block without a fingerprint (short fence nonce) stays unknown: no duplicate_identity, no reject", async () => {
      const shortNonce = daemonEntry(TS, KEY).split(NONCE).join("aa");
      writeFileSync(proposed, shortNonce);
      expect((await countersign({ note: "ok" })).status).toBe(200);
      expect(read(logged)).not.toContain("proposal:");
      writeFileSync(proposed, shortNonce); // the removal "did not happen"
      const again = await countersign({});
      expect(again.status).toBe(409);
      expect(again.body).not.toMatchObject({ error: "duplicate_identity" });
      const rej = await handleRejectRequest({ leadsRoot: root, author: () => AUTHOR, now: () => new Date(NOW) }, { timestamp: TS, leadId: LEAD });
      expect(rej.status).not.toBe(200);
      expect(existsSync(path.join(root, "decisions-rejected.md"))).toBe(false);
      expect(read(proposed)).toBe(shortNonce);
    });

    // @covers FR-01.71
    it("a retry of an already logged entry with an invalid note still answers already countersigned", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY));
      await countersign({ note: "ok" });
      const res = await countersign({ note: "z".repeat(601) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ alreadyCountersigned: true, adr: "ADR-0001" });
    });

    // @covers FR-01.71
    it("a whole (unfenced) entry gets the note after its body and its crash residue still heals", async () => {
      const body = "Plain learning.\n\n- Note: the lead's own last item";
      writeFileSync(proposed, webuiEntry(TS, body));
      await countersign({ note: "operator note" });
      expect(read(logged)).toContain("- Note: the lead's own last item\n\n- Note: operator note\n\n");
      writeFileSync(proposed, webuiEntry(TS, body));
      const res = await countersign({});
      expect(res.body).toMatchObject({ alreadyCountersigned: true });
      expect(read(proposed)!.trim()).toBe("");
    });

    // @covers FR-01.71
    it("a lead body that itself ends in a Note item, countersigned without a note, heals by exact match", async () => {
      const body = "Plain learning.\n\n- Note: the lead's own last item";
      writeFileSync(proposed, webuiEntry(TS, body));
      await countersign({});
      writeFileSync(proposed, webuiEntry(TS, body));
      expect((await countersign({})).body).toMatchObject({ alreadyCountersigned: true });
    });

    // @covers FR-01.71
    it("an old whole-entry body that is exactly a line item plus a Note item still heals body for body", async () => {
      const body = "- Plain line.\n- Note: written by the lead";
      writeFileSync(proposed, webuiEntry(TS, body));
      await countersign({});
      writeFileSync(proposed, webuiEntry(TS, body));
      expect((await countersign({})).body).toMatchObject({ alreadyCountersigned: true });
      expect(read(proposed)!.trim()).toBe("");
    });

    // @covers FR-01.71
    it("a note that is too long, repeats a quote or is not text is refused with nothing changed", async () => {
      writeFileSync(proposed, daemonEntry(TS, KEY, LINE, QUOTE));
      expect((await countersign({ note: "z".repeat(601) })).body.error).toBe("note_too_long");
      expect((await countersign({ note: "every single update should arrive in one combined mail" })).body.error).toBe("note_contains_quote");
      expect((await countersign({ note: ["x"] })).body.error).toBe("note_invalid");
      expect(read(logged) ?? "").toBe("");
      expect(auditLines()).toHaveLength(0);
    });
  });

});
