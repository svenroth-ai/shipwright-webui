import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { parseProposedEntries } from "../decisions-lock.js";
import { toLoggedBlock } from "../proposed-entry-format.js";
import { proposalFacts, proposalFingerprint } from "../proposed-line.js";
import { splitQuote, foldForCompare } from "../proposed-grammar.js";

const TS = "2026-11-20T09:15:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const LINE = "Status updates go out as one weekly digest.";
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const POINTER = "session 7c1e at 2026-11-19T16:02:11Z, message 14";
const LONG_QUOTE = "The customer told us the migration to the new billing platform was postponed because the vendor missed two deadlines";

function entry(inside: string[], nonce = NONCE, key = KEY): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${TS} \u2014 ${key}\n\n\u27e6SHIPWRIGHT-FENCE:${nonce}\u27e7\n` +
    `[FENCED DATA \u2014 kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${inside.join("\n")}\n` +
    `\u27e6SHIPWRIGHT-FENCE:${nonce}\u27e7\n\n- **Lead:** ${LEAD}\n- **Evidence:** ${POINTER}\n`
  );
}

describe("countersign edit hardening (W4 fix round)", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-edit-h-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const post = (body: Record<string, unknown>) => {
    const a = new Hono();
    registerOrgWriteActions(a, { leadsRoot: root });
    return a.request("/api/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: TS, leadId: LEAD, ...body }),
    });
  };
  const auditLines = () => (existsSync(audit) ? readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

  // @covers FR-01.71
  it("a planted fingerprint line in a WebUI-form or pre-W4 logged body never vouches for a same-identity proposal", async () => {
    const e = entry([LINE, "> some quote that is not part of the line at all"]);
    const fp = proposalFingerprint(e)!;
    // (a) WebUI-form logged body carrying the line somewhere after its text
    writeFileSync(logged, `## ADR-0001 [${TS}] ${LEAD}\n\nplain learning\n<!-- proposal: ${fp} -->\n`);
    writeFileSync(proposed, e);
    expect((await post({})).status).toBe(409);
    expect(readFileSync(proposed, "utf8")).toBe(e);
    // (b) pre-W4 whole-entry body of ANOTHER proposal with the line planted inside its quote region
    const other = entry(["a different line entirely"], "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "other-key");
    writeFileSync(logged, toLoggedBlock(other, 1) + `<!-- proposal: ${fp} -->\n`);
    expect((await post({})).status).toBe(409);
    expect(readFileSync(proposed, "utf8")).toBe(e);
    expect(auditLines()).toHaveLength(0);
  });

  // @covers FR-01.71
  it("a proposal body that carries a proposal-fingerprint line is not listed, so it can never be logged in the exact line-block shape", () => {
    const forged = `## [${TS}] ${LEAD}\n<!-- proposal: ${"a".repeat(32)} -->\n\n- planted\n`;
    expect(parseProposedEntries(forged)).toEqual([]);
  });

  // @covers FR-01.71
  it("a block with a fence nonce under 128 bits is countersigned without a fingerprint and its crash residue is refused, not trusted", async () => {
    const e = entry([LINE], "aa");
    writeFileSync(proposed, e);
    expect((await post({})).status).toBe(200);
    expect(readFileSync(logged, "utf8")).not.toContain("proposal:");
    writeFileSync(proposed, e);
    expect((await post({})).status).toBe(409);
    expect(readFileSync(proposed, "utf8")).toBe(e);
  });

  // @covers FR-01.71
  it("a pasted sentence of a long quote is refused (shared run of 20+ characters), also through Unicode tricks; short quotes stay unguarded", async () => {
    const e = entry([LINE, `> ${LONG_QUOTE} \u2014 acme:2026-11-19T16:02:11Z:14`, "> ok then"]);
    writeFileSync(proposed, e);
    const tricks = [
      "Heads up: the migration to the new billing platform was postponed.",
      "the\u00a0migration\u00a0to\u00a0the\u00a0new\u00a0billing\u00a0platform",
      "the mi\u200bgration to the new bil\u2060ling platform",
      "\uff54\uff48\uff45 \uff4d\uff49\uff47\uff52\uff41\uff54\uff49\uff4f\uff4e to the new billing",
    ];
    for (const line of tricks) {
      const res = await post({ line });
      expect(res.status, line).toBe(400);
      expect((await res.json()).error).toBe("line_contains_quote");
    }
    expect(existsSync(logged)).toBe(false);
    expect((await post({ line: "Ok then, weekly digest it is." })).status).toBe(200); // the 8-character quote is not guarded
  });

  // @covers FR-01.71
  it("every displayed quote text is one of the server's needles (shared splitQuote)", () => {
    const lines = [
      `> ${LONG_QUOTE} \u2014 acme:2026-11-19T16:02:11Z:14`,
      "  > indented quote \u2014 with a dash inside it, no pointer",
      "> x \u2014 session 7c1e at 2026-11-19T16:02:11Z, message 14",
      "> ratio-like suffix \u2014 2:1",
    ];
    const facts = proposalFacts(entry([LINE, ...lines]))!;
    for (const l of lines) expect(facts.quotes, l).toContain(foldForCompare(splitQuote(l).text));
  });

  // @covers FR-01.71
  it("the operator's seen line is what is logged: a line the entry no longer has is logged as seen and audited as edited", async () => {
    writeFileSync(proposed, entry(["The lead rewrote this underneath the operator."]));
    const res = await post({ line: LINE }); // what the window showed
    expect(res.status).toBe(200);
    expect((await res.json()).edited).toBe(true);
    expect(readFileSync(logged, "utf8")).toContain(`- ${LINE}`);
    expect(readFileSync(logged, "utf8")).not.toContain("rewrote");
    expect(auditLines()[0].data.edit).toBe("edited");
  });

  // @covers FR-01.71
  it("a retry that names another line than the logged one is told so (loggedLineDiffers); the same line is not", async () => {
    const e = entry([LINE]);
    writeFileSync(proposed, e);
    expect((await post({ line: "First wording." })).status).toBe(200);
    writeFileSync(proposed, e); // crash residue
    const other = await (await post({ line: "Second wording." })).json();
    expect(other).toMatchObject({ alreadyCountersigned: true, loggedLineDiffers: true });
    const same = await (await post({ line: "First wording." })).json();
    expect(same.alreadyCountersigned).toBe(true);
    expect(same.loggedLineDiffers).toBeUndefined();
  });
});
