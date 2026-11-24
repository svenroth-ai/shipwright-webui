import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { parseProposedEntries } from "../decisions-lock.js";
import { parseEvidence, parseSourceRef, fencedParts } from "../proposed-grammar.js";
import { proposalFacts } from "../proposed-line.js";

// Evidence-line quote grammar: leadwright writes `- **Evidence:** <session>:<ISO>:<n> — "<quote>"` (not a `> text — pointer`
// line inside the fence). Fixture: leadwright tests/fixtures/decisions-proposed-renderentry-sample.md (renderEntry output,
// leadwright commit 44a6606 / #141).
const FIXTURE = path.join(import.meta.dirname, "fixtures", "decisions-proposed-renderentry-sample.md");
const POINTER = "s1:2026-11-19T16:02:11.123Z:3";
const TS = "2026-11-24T10:30:00.000Z";
const LEAD = "acme-lead";
const NONCE = "abababababababababababababababab";

function entry(inside: string[], evidence: string): string {
  return (
    `<!-- decisionKey: k1 -->\n## [${TS}] ${LEAD}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${inside.join("\n")}\n` +
    `⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** ${evidence}\n`
  );
}

describe("parseEvidence (Evidence-line quote grammar)", () => {
  // @covers FR-01.71
  it("a known pointer plus exactly one quote", () => {
    const r = parseEvidence(`${POINTER} — "keep status updates as one weekly digest"`);
    expect(r.source).toEqual({ kind: "known", session: "s1", time: "2026-11-19T16:02:11.123Z", message: "3" });
    expect(r.quote).toBe("keep status updates as one weekly digest");
  });

  // @covers FR-01.71
  it("a quote holding an em dash and double quotes survives (greedy match)", () => {
    const q = 'she said "ship it" — then left — for good "now"';
    expect(parseEvidence(`${POINTER} — "${q}"`).quote).toBe(q);
  });

  // @covers FR-01.71
  it("an unknown source with quote-like text is handled exactly as before: unknown, no quote", () => {
    for (const raw of ['see the chat — "keep status updates as one weekly digest"', 'abc — "quote quote quote quote quote"', 's1:notatime:3 — "keep status updates as one weekly digest"']) {
      expect(parseEvidence(raw)).toEqual({ source: parseSourceRef(raw), quote: null });
    }
    expect(parseEvidence(null)).toEqual({ source: { kind: "unknown", raw: null }, quote: null });
    expect(parseEvidence(POINTER)).toEqual({ source: parseSourceRef(POINTER), quote: null });
    expect(parseEvidence("session 7c1e at 2026-11-19T16:02:11Z, message 14").quote).toBeNull();
  });

  // @covers FR-01.71
  it("an empty, blank or invisible-only quote is no quote; the long pointer form with a quote is unknown", () => {
    for (const q of ["", "   ", "​​"]) expect(parseEvidence(`${POINTER} — "${q}"`)).toEqual({ source: parseSourceRef(POINTER), quote: null });
    expect(parseEvidence('session 7c1e at 2026-11-19T16:02:11Z, message 14 — "keep status updates as one weekly digest"').quote).toBeNull();
  });

  // @covers FR-01.71
  it("a quote with a line separator character still parses; an unterminated quote falls back to unknown source", () => {
    expect(parseEvidence(`${POINTER} — "keep status updates as one weekly digest"`).quote).toBe("keep status updates as one weekly digest");
    expect(parseEvidence(`${POINTER} — "keep status updates as one weekly dige`)).toEqual({ source: parseSourceRef(`${POINTER} — "keep status updates as one weekly dige`), quote: null });
  });

  // @covers FR-01.71
  it("the old `> text — pointer` fence form is NOT adopted for the Evidence line", () => {
    expect(parseEvidence(`> keep status updates as one weekly digest — ${POINTER}`).quote).toBeNull();
    expect(parseEvidence(`${POINTER} - "ascii dash is not the separator at all"`).quote).toBeNull();
  });
});

describe("pinned leadwright renderEntry sample", () => {
  const raw = readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n");

  // @covers FR-01.71
  it("hash is named in the contract doc", () => {
    const sha = createHash("sha256").update(raw).digest("hex");
    const doc = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "org-proposed-entry-contract.md"), "utf8");
    expect(doc).toContain(sha);
  });

  // @covers FR-01.71
  it("entry 2 yields a known source and its quote; the fence holds no quote line", () => {
    const entries = parseProposedEntries(raw);
    expect(entries).toHaveLength(2);
    const facts = proposalFacts(entries[1].block);
    expect(facts?.evidence).toEqual({ session: "s1", time: "2026-11-19T16:02:11.123Z", message: "3" });
    expect(fencedParts(entries[1].block.split("\n"))?.quotes).toEqual([]);
    expect(facts?.quotes).toContain("keep status updates as one weekly digest");
  });
});

describe("countersign with an Evidence-line quote", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-evq-"));
    proposed = path.join(root, "decisions-proposed.md");
    logged = path.join(root, "decision_log.md");
    audit = path.join(root, LEAD, "audit.jsonl");
    mkdirSync(path.join(root, LEAD), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const QUOTE = "keep status updates as one weekly digest";
  const post = (body: Record<string, unknown>) => {
    const a = new Hono();
    registerOrgWriteActions(a, { leadsRoot: root });
    return a.request("/api/org/decisions/countersign", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timestamp: TS, leadId: LEAD, ...body }),
    });
  };
  const auditRaw = () => (existsSync(audit) ? readFileSync(audit, "utf8") : "");

  // @covers FR-01.71
  it("an unedited line that repeats the quote is refused with 400 line_contains_quote; the entry stays", async () => {
    writeFileSync(proposed, entry([`Please ${QUOTE} from now on.`], `${POINTER} — "${QUOTE}"`));
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("line_contains_quote");
    expect((await (await post({ line: `They said: ${QUOTE.toUpperCase()}` })).json()).error).toBe("line_contains_quote");
    expect(existsSync(logged)).toBe(false);
    expect(readFileSync(proposed, "utf8")).toContain(QUOTE);
  });

  // @covers FR-01.71
  it("an edited line passes; the audit evidence is the structured pointer and never carries the quote", async () => {
    writeFileSync(proposed, entry([`Please ${QUOTE} from now on.`], `${POINTER} — "${QUOTE}"`));
    const res = await post({ line: "Status goes out once a week." });
    expect(res.status).toBe(200);
    const rec = JSON.parse(auditRaw().split("\n").filter(Boolean)[0]);
    expect(rec.data.evidence).toEqual({ session: "s1", time: "2026-11-19T16:02:11.123Z", message: "3" });
    expect(auditRaw()).not.toContain(QUOTE);
    expect(readFileSync(logged, "utf8")).not.toContain(QUOTE);
  });

  // @covers FR-01.71
  it("an unknown source with quote-like text adds no guard needle and a null audit evidence", async () => {
    const block = entry(["Status goes out once a week."], `see the chat — "${QUOTE}"`);
    writeFileSync(proposed, block);
    expect(proposalFacts(block)?.quotes).toEqual([]);
    expect((await post({})).status).toBe(200);
    expect(JSON.parse(auditRaw().split("\n").filter(Boolean)[0]).data.evidence).toBeNull();
  });
});
