import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { toLoggedBlock } from "../proposed-entry-format.js";
import { decisionKeyOf } from "../proposed-decision-key.js";

const TS = "2026-11-20T09:15:00.000Z";
const TS2 = "2026-11-20T10:30:00.000Z";
const LEAD = "acme-lead";
const QUOTE = "Status updates go out as one weekly digest instead of per-task messages.";
const NONCE2 = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function daemonEntry(ts: string, key: string, text = QUOTE, nonce = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c"): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${nonce}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${text}\n` +
    `⟦SHIPWRIGHT-FENCE:${nonce}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** session 7c1e at 2026-11-19T16:02:11Z, message 14\n`
  );
}
const webuiEntry = (ts: string) => `## [${ts}] ${LEAD}\n\nPlain WebUI-form learning.\n`;

describe("reject a proposed entry (W3)", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-reject-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const app = (): Hono => {
    const a = new Hono();
    registerOrgWriteActions(a, { leadsRoot: root });
    return a;
  };
  const post = (a: Hono, route: string, body: unknown) =>
    a.request(`/api/org/decisions/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const auditLines = () =>
    existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];


  // @covers FR-01.71
  it("removes the entry and leaves ONE audit line with author, lead and decision key - no quote text", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest") + daemonEntry(TS2, "keep-reviews", "Other text.", NONCE2));
    const res = await post(app(), "reject", { timestamp: TS, leadId: LEAD, reason: "too vague" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: true, alreadyRejected: false });
    const left = readFileSync(proposed, "utf8");
    expect(left).not.toContain("use-weekly-digest");
    expect(left).toContain("keep-reviews"); // neighbour untouched
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("decision_rejected");
    expect(lines[0].lead_id).toBe(LEAD);
    expect(lines[0].data.decisionKey).toBe("use-weekly-digest");
    expect(lines[0].data.reason).toBe("too vague");
    expect(typeof lines[0].data.author).toBe("string");
    expect(lines[0].data.author.length).toBeGreaterThan(0);
    expect(readFileSync(audit, "utf8")).not.toContain("weekly digest instead");
    expect(readFileSync(audit, "utf8")).not.toContain("message 14");
  });


  // @covers FR-01.71
  it("a double click (two concurrent requests) rejects once", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest"));
    const a = app();
    const [r1, r2] = await Promise.all([
      post(a, "reject", { timestamp: TS, leadId: LEAD }),
      post(a, "reject", { timestamp: TS, leadId: LEAD }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const bodies = [await r1.json(), await r2.json()];
    expect(bodies.filter((b) => b.alreadyRejected === false)).toHaveLength(1);
    expect(readFileSync(proposed, "utf8")).not.toContain("use-weekly-digest");
    expect(auditLines()).toHaveLength(1);
  });


  // @covers FR-01.71
  it("retry after a crash between the audit line and the removal removes the entry without a second audit line", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest"));
    writeFileSync(
      audit,
      JSON.stringify({ kind: "decision_rejected", lead_id: LEAD, data: { entryTimestamp: TS, decisionKey: "use-weekly-digest", author: "sven" } }) + "\n",
    );
    const res = await post(app(), "reject", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(200);
    expect(readFileSync(proposed, "utf8")).not.toContain("use-weekly-digest");
    expect(auditLines()).toHaveLength(1);
  });


  // @covers FR-01.71
  it("rejecting again after success is a quiet 200 alreadyRejected; an unknown entry is 404", async () => {
    writeFileSync(proposed, webuiEntry(TS));
    const a = app();
    expect((await post(a, "reject", { timestamp: TS, leadId: LEAD })).status).toBe(200);
    const again = await post(a, "reject", { timestamp: TS, leadId: LEAD });
    expect(await again.json()).toEqual({ rejected: true, alreadyRejected: true });
    expect(auditLines()).toHaveLength(1);
    expect(auditLines()[0].data.decisionKey).toBeNull(); // key-less WebUI entry
    expect((await post(a, "reject", { timestamp: TS2, leadId: LEAD })).status).toBe(404);
  });


  // @covers FR-01.71
  it("refuses an entry already countersigned, validates input, flattens a multi-line reason", async () => {
    writeFileSync(proposed, webuiEntry(TS));
    const a = app();
    expect((await post(a, "countersign", { timestamp: TS, leadId: LEAD })).status).toBe(200);
    const res = await post(a, "reject", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_countersigned");
    expect((await post(a, "reject", { timestamp: "nope", leadId: LEAD })).status).toBe(400);
    expect((await post(a, "reject", { timestamp: TS, leadId: "Bad_Id" })).status).toBe(400);

    writeFileSync(proposed, webuiEntry(TS2));
    await post(a, "reject", { timestamp: TS2, leadId: LEAD, reason: 'a\n{"kind":"forged"}' });
    const lines = auditLines();
    expect(lines.map((l) => l.kind)).toEqual(["decision_countersigned", "decision_rejected"]);
    expect(lines[1].data.reason).toBe('a {"kind":"forged"}');
  });


  // @covers FR-01.71
  it("rejected-keys lists a lead's rejected keys; a repeat proposal of that key is detectable", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest"));
    const a = app();
    await post(a, "reject", { timestamp: TS, leadId: LEAD });
    writeFileSync(proposed, daemonEntry(TS2, "use-weekly-digest", "Reworded.", NONCE2));
    const res = await a.request(`/api/org/decisions/rejected-keys?leadIds=${LEAD},other-lead`);
    expect(await res.json()).toEqual({ byLead: { [LEAD]: [{ key: "use-weekly-digest", entryTimestamp: TS }], "other-lead": [] } });
    expect((await a.request("/api/org/decisions/rejected-keys?leadIds=Bad_Id")).status).toBe(200);
  });


  // @covers FR-01.71
  it("countersign writes one audit line with the author and ADR, exactly once across a retry", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest"));
    const a = app();
    const first = await post(a, "countersign", { timestamp: TS, leadId: LEAD });
    expect((await first.json()).adr).toBe("ADR-0001");
    await post(a, "countersign", { timestamp: TS, leadId: LEAD });
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "decision_countersigned", lead_id: LEAD });
    expect(lines[0].data).toMatchObject({ decisionKey: "use-weekly-digest", adr: "ADR-0001" });
    expect(readFileSync(audit, "utf8")).not.toContain("weekly digest instead");
  });


  // @covers FR-01.71
  it("countersign retry after a crash between log write and audit completes the audit once", async () => {
    const entry = daemonEntry(TS, "use-weekly-digest");
    writeFileSync(proposed, entry);
    // crash residue: logged, still proposed, no audit line
    writeFileSync(logged, toLoggedBlock(entry, 1));
    const res = await post(app(), "countersign", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(200);
    expect(auditLines()).toHaveLength(1);
    expect(readFileSync(proposed, "utf8")).not.toContain("use-weekly-digest");
  });


  // @covers FR-01.71
  it("countersign of an entry whose reject was recorded but not completed finishes the removal and does not approve it", async () => {
    writeFileSync(proposed, daemonEntry(TS, "use-weekly-digest"));
    writeFileSync(audit, JSON.stringify({ kind: "decision_rejected", lead_id: LEAD, data: { entryTimestamp: TS, decisionKey: "use-weekly-digest", author: "sven" } }) + "\n");
    const res = await post(app(), "countersign", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(404);
    expect(readFileSync(proposed, "utf8")).not.toContain("use-weekly-digest");
    expect(existsSync(logged)).toBe(false);
    expect(auditLines()).toHaveLength(1);
  });


  // @covers FR-01.71
  it("reject of an entry that is already logged (countersign crashed before removal) is refused, not recorded", async () => {
    const entry = daemonEntry(TS, "use-weekly-digest");
    writeFileSync(proposed, entry);
    writeFileSync(logged, toLoggedBlock(entry, 1));
    const res = await post(app(), "reject", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(409);
    expect(auditLines()).toHaveLength(0);
    expect(readFileSync(proposed, "utf8")).toContain("use-weekly-digest");
  });


  // @covers FR-01.71
  it("countersign does not swallow a NEW proposal that merely reuses the timestamp of a rejected one", async () => {
    writeFileSync(proposed, daemonEntry(TS, "other-key"));
    writeFileSync(audit, JSON.stringify({ kind: "decision_rejected", lead_id: LEAD, data: { entryTimestamp: TS, decisionKey: "use-weekly-digest", author: "sven" } }) + "\n");
    const res = await post(app(), "countersign", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(200);
    expect(readFileSync(logged, "utf8")).toContain("other-key");
  });


  // @covers FR-01.71
  it("rejecting an entry of a lead with no folder is refused and creates nothing", async () => {
    rmSync(path.join(root, LEAD), { recursive: true, force: true });
    writeFileSync(proposed, webuiEntry(TS));
    const res = await post(app(), "reject", { timestamp: TS, leadId: LEAD });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("lead_unknown");
    expect(existsSync(path.join(root, LEAD))).toBe(false);
    expect(readFileSync(proposed, "utf8")).toContain(TS);
  });


  // @covers FR-01.71
  it("decisionKeyOf: marker, daemon header, none", () => {
    expect(decisionKeyOf(daemonEntry(TS, "k-1"))).toBe("k-1");
    expect(decisionKeyOf(`## Proposed ${TS} — k-2\n\nbody`)).toBe("k-2");
    expect(decisionKeyOf(webuiEntry(TS))).toBeNull();
    expect(decisionKeyOf("<!--decisionKey:   spaced-key  -->\n## [x] y\n")).toBe("spaced-key");
  });
});
