/*
 * Closing the limits left by org-proposals-hardening (iterate org-proposals-limits-closeout): a reject retry with
 * another reason reuses the record, reject on an audit_pending entry says so, and a rewritten entry whose older
 * version is already logged can be rejected (the way out of duplicate_identity).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir, userInfo } from "node:os";

import { createOrgApiRouter } from "../../../routes/org.js";
import { performCountersign } from "../countersign-core.js";
import { parseProposedEntries } from "../decisions-lock.js";
import { blockDigest } from "../proposed-line.js";
import { residueKind } from "../decision-residue.js";
import { toLoggedBlock } from "../decisions-lock.js";

const TS = "2026-11-20T09:15:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const NONCE2 = "9a1c0e5b7d42a8916c0d2e4f6a8b1c3f";

function entry(text: string, nonce = NONCE): string {
  return (
    `<!-- decisionKey: ${KEY} -->\n## Proposed ${TS} — ${KEY}\n\n⟦SHIPWRIGHT-FENCE:${nonce}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${text}\n` +
    `⟦SHIPWRIGHT-FENCE:${nonce}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14\n`
  );
}

describe("limits closeout", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-closeout-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const router = () => createOrgApiRouter({ leadsRoot: root, honoHost: "127.0.0.1" });
  const post = (route: string, body: Record<string, unknown>) =>
    router().request(`/api/org/decisions/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timestamp: TS, leadId: LEAD, ...body }) });
  const auditLines = () => (existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const me = () => userInfo().username || "operator";
  const failOnce = () => {
    let calls = 0;
    return () => {
      if (calls++ === 0) throw Object.assign(new Error("EACCES: simulated"), { code: "EACCES" });
      return new Date("2026-11-20T10:00:00.000Z");
    };
  };
  const rejectedLine = (author: string, reason: string | null) =>
    JSON.stringify({ ts: "2026-11-20T09:20:00.000Z", kind: "decision_rejected", lead_id: LEAD, data: { action: "rejected", author, entryTimestamp: TS, decisionKey: KEY, reason } }) + "\n";

  describe("reject retry with a different reason", () => {
    // @covers FR-01.71
    it("reuses this webui record: no second line, and the answer says which reason is on record", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, rejectedLine(me(), "too vague")); // crash residue: our record exists, the entry is still listed
      const res = await post("reject", { reason: "wrong team" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ rejected: true, recorded: false, reasonKept: true, existingReason: "too vague" });
      expect(auditLines()).toHaveLength(1);
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
    });

    // @covers FR-01.71
    it("an identical retry stays quiet (no reasonKept); a record without a reason is reported as null", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, rejectedLine(me(), null));
      const same = await (await post("reject", {})).json();
      expect(same.recorded).toBe(false);
      expect(same.reasonKept).toBeUndefined();
      writeFileSync(proposed, entry("Line one."));
      const other = await (await post("reject", { reason: "later note" })).json();
      expect(other).toMatchObject({ reasonKept: true, existingReason: null });
      expect(auditLines()).toHaveLength(1);
    });

    // @covers FR-01.71
    it("a foreign-author line is still not ours: the reject writes its own record", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, rejectedLine("someone-else", "x"));
      const body = await (await post("reject", { reason: "mine" })).json();
      expect(body.recorded).toBe(true);
      expect(body.reasonKept).toBeUndefined();
      expect(auditLines()).toHaveLength(2);
    });
  });

  describe("reject on an audit_pending entry", () => {
    // @covers FR-01.71
    it("answers 409 countersign_audit_pending (not already_countersigned) and changes nothing; countersign then finishes", async () => {
      writeFileSync(proposed, entry("Line one."));
      const first = await performCountersign({ leadsRoot: root, author: me(), now: failOnce() }, TS, LEAD);
      expect(first.status).toBe("audit_pending");
      const res = await post("reject", { reason: "no" });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("countersign_audit_pending");
      expect(body.number).toBe(1);
      expect(body.message).toMatch(/audit record is missing/);
      expect(readFileSync(proposed, "utf8")).toContain(KEY);
      expect(auditLines()).toHaveLength(0);
      expect((await post("countersign", {})).status).toBe(200);
      expect(auditLines()).toHaveLength(1);
    });

    // @covers FR-01.71
    it("a complete countersign (record present, entry still listed) is still reported as already countersigned", async () => {
      writeFileSync(proposed, entry("Line one."));
      await performCountersign({ leadsRoot: root, author: me() }, TS, LEAD);
      writeFileSync(proposed, entry("Line one.")); // residue: the removal did not happen
      const res = await post("reject", {});
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("already_countersigned");
    });
  });

  describe("a logged block that cannot be fingerprinted (short fence nonce)", () => {
    // @covers FR-01.71
    it("is never taken for a different proposal: Reject fails closed (no removal, no misleading advice) and countersign does not offer Reject", async () => {
      const SHORT = "ab12cd34";
      writeFileSync(proposed, entry("Line one.", SHORT));
      const first = await performCountersign({ leadsRoot: root, author: me(), now: failOnce() }, TS, LEAD);
      expect(first.status).toBe("audit_pending");
      const fingerprint = blockDigest(parseProposedEntries(readFileSync(proposed, "utf8"))[0].block);
      const rej = await post("reject", { reason: "no", fingerprint });
      expect(rej.status).toBe(409);
      expect((await rej.json()).error).toBe("already_countersigned"); // Countersign cannot finish it either: no false advice
      expect(readFileSync(proposed, "utf8")).toContain(KEY); // still listed
      const dup = await (await post("countersign", {})).json();
      expect(dup.error).toBe("duplicate_proposal_identity");
      expect(dup.loggedAdr).toBeUndefined();
    });
  });

  describe("whole-entry log form", () => {
    // @covers FR-01.71
    it("a residue rewritten with other line endings or trailing blanks is still the same proposal", () => {
      const NL = String.fromCharCode(10);
      const listed = ["## [2026-11-20T09:15:00.000Z] acme-lead", "", "Body text.", ""].join(NL);
      const logged = { number: 3, block: toLoggedBlock(listed, 3) };
      expect(residueKind(logged, listed)).toBe("same");
      expect(residueKind(logged, listed.split(NL).join(String.fromCharCode(13, 10)) + "  ")).toBe("same");
      expect(residueKind(logged, listed.replace("Body text.", "Other text."))).toBe("different");
    });
  });

  describe("reason text read back from the audit file", () => {
    // @covers FR-01.71
    it("is normalised and bounded before it is returned", async () => {
      writeFileSync(proposed, entry("Line one."));
      writeFileSync(audit, rejectedLine(me(), "x".repeat(900)));
      const body = await (await post("reject", { reason: "other" })).json();
      expect(body.reasonKept).toBe(true);
      expect(body.existingReason.length).toBeLessThanOrEqual(280);
    });
  });

  describe("audit_pending and the lead rewrote the entry", () => {
    // @covers FR-01.71
    it("countersign names the logged ADR; Reject removes the rewritten version and leaves the log alone", async () => {
      writeFileSync(proposed, entry("Line one."));
      await performCountersign({ leadsRoot: root, author: me(), now: failOnce() }, TS, LEAD);
      writeFileSync(proposed, entry("Line one, rewritten by the lead.", NONCE2));
      const dup = await post("countersign", {});
      expect(dup.status).toBe(409);
      expect(await dup.json()).toMatchObject({ error: "duplicate_proposal_identity", count: 2, loggedAdr: "ADR-0001" });
      const logBefore = readFileSync(logged, "utf8");
      // without a fingerprint nothing proves the operator saw this version: a different proposal is never removed unchecked
      const unchecked = await post("reject", { reason: "no fingerprint" });
      expect(unchecked.status).toBe(409);
      expect((await unchecked.json()).error).toBe("already_countersigned");
      expect(readFileSync(proposed, "utf8")).toContain("rewritten by the lead");
      const fingerprint = blockDigest(parseProposedEntries(readFileSync(proposed, "utf8"))[0].block);
      const rej = await post("reject", { reason: "rewritten, not wanted", fingerprint });
      expect(rej.status).toBe(200);
      expect(await rej.json()).toMatchObject({ rejected: true, recorded: true });
      expect(readFileSync(proposed, "utf8")).not.toContain(KEY);
      expect(readFileSync(logged, "utf8")).toBe(logBefore);
      const rejected = auditLines().filter((l) => l.kind === "decision_rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0].data.supersededAdr).toBe("ADR-0001");
      // the record is about the rewrite, never a rejection of the approved key: no repeat hint for it
      const keys = await (await router().request(`/api/org/decisions/rejected-keys?leadIds=${LEAD}`)).json();
      expect(keys.byLead[LEAD] ?? []).toEqual([]);
    });
  });
});
