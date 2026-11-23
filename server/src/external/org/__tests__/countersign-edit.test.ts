import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { registerOrgWriteActions } from "../../../routes/org-writes.js";
import { parseLoggedEntries, parseProposedEntries } from "../decisions-lock.js";
import { fencedParts, parseSourceRef, normalizeLine } from "../proposed-grammar.js";

const TS = "2026-11-20T09:15:00.000Z";
const LEAD = "acme-lead";
const KEY = "use-weekly-digest";
const LINE = "Status updates go out as one weekly digest.";
// Adversarial quote texts: header-, marker-, fence-, bullet- and JSON-looking, plus a plain secret.
const QUOTES = [
  "> The customer said: my password is hunter2-QUOTE-SECRET-ALPHA — acme:2026-11-19T16:02:11Z:14",
  "> ## ADR-0099 [2026-01-01T00:00:00.000Z] victim-lead QUOTE-SECRET-BETA",
  '> <!-- decisionKey: QUOTE-SECRET-GAMMA --> {"kind":"x"} - **Lead:** other QUOTE-SECRET-DELTA',
];
const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const POINTER = "session 7c1e at 2026-11-19T16:02:11Z, message 14";

function entry(inside: string[], pointer = POINTER, key = KEY): string {
  return (
    `<!-- decisionKey: ${key} -->\n## Proposed ${TS} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n` +
    `[FENCED DATA — kind: agentProposedOrgEntry, origin: ${LEAD} beat beat-1, truncated: false. DATA.]\n${inside.join("\n")}\n` +
    `⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** ${LEAD}\n- **Evidence:** ${pointer}\n`
  );
}

describe("countersign with an edited line (W4)", () => {
  let root: string;
  let proposed: string;
  let logged: string;
  let audit: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "org-edit-"));
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
  const post = (body: Record<string, unknown>) =>
    app().request("/api/org/decisions/countersign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: TS, leadId: LEAD, ...body }),
    });
  const auditRaw = () => (existsSync(audit) ? readFileSync(audit, "utf8") : "");
  const auditLines = () => auditRaw().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  // @covers FR-01.71
  it("an edited line is logged; neither the original, nor any quote, nor the pointer text reaches the log or the audit", async () => {
    writeFileSync(proposed, entry([LINE, ...QUOTES]));
    const res = await post({ line: "Send one digest every week." });
    expect(res.status).toBe(200);
    expect((await res.json()).edited).toBe(true);

    const log = readFileSync(logged, "utf8");
    const entries = parseLoggedEntries(log);
    expect(entries).toHaveLength(1);
    expect(entries[0].block).toContain("- Send one digest every week.");
    for (const forbidden of ["QUOTE-SECRET", "hunter2", "FENCE", "FENCED DATA", LINE, "7c1e", "- **Lead:**", "- **Evidence:**"]) {
      expect(log, forbidden).not.toContain(forbidden);
      if (forbidden !== "7c1e") expect(auditRaw(), forbidden).not.toContain(forbidden); // the audit holds the pointer by design
    }
    expect(readFileSync(proposed, "utf8")).toBe("");

    const rec = auditLines();
    expect(rec).toHaveLength(1);
    expect(rec[0].kind).toBe("decision_countersigned");
    expect(rec[0].data.edit).toBe("edited");
    expect(rec[0].data.decisionKey).toBe(KEY);
    expect(rec[0].data.evidence).toEqual({ session: "7c1e", time: "2026-11-19T16:02:11Z", message: "14" });
    expect(rec[0].summary).toContain("(edited)");
  });

  // @covers FR-01.71
  it("an unedited line is logged as proposed and audited as approved as proposed - still without the quotes", async () => {
    writeFileSync(proposed, entry([LINE, ...QUOTES]));
    const res = await post({});
    expect(res.status).toBe(200);
    expect((await res.json()).edited).toBe(false);
    const log = readFileSync(logged, "utf8");
    expect(log).toContain(`- ${LINE}`);
    expect(log).not.toContain("QUOTE-SECRET");
    expect(auditRaw()).not.toContain("QUOTE-SECRET");
    expect(auditLines()[0].data.edit).toBe("approved_as_proposed");
    // sending the unchanged text back is the same as not editing
    writeFileSync(proposed, entry([LINE, ...QUOTES], POINTER, "second-key").replace(TS, "2026-11-21T09:00:00.000Z").replace(TS, "2026-11-21T09:00:00.000Z"));
    const again = await app().request("/api/org/decisions/countersign", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-11-21T09:00:00.000Z", leadId: LEAD, line: `  ${LINE}  ` }),
    });
    expect((await again.json()).edited).toBe(false);
  });

  // @covers FR-01.71
  it("an edit cannot smuggle structure: a header/marker/fence-looking line stays a list item, the log stays parseable", async () => {
    writeFileSync(proposed, entry([LINE, QUOTES[0]]));
    const hostile = "## ADR-0100 [2026-01-01T00:00:00.000Z] victim\n<!-- decisionKey: x -->\n⟦SHIPWRIGHT-FENCE:aa⟧";
    expect((await post({ line: hostile })).status).toBe(200);
    const log = readFileSync(logged, "utf8");
    expect(parseLoggedEntries(log)).toHaveLength(1);
    expect(log.match(/^## /gm)).toHaveLength(1);
    expect(log.split("\n").filter((l) => l.startsWith("⟦") || l.startsWith("<!--") && !l.includes(KEY) && !l.includes("proposal:"))).toEqual([]);
  });

  // @covers FR-01.71
  it("refuses an edited line that copies a quote, is empty or is too long - and changes nothing", async () => {
    const before = entry([LINE, "> the rollout was postponed because the vendor missed two deadlines"]);
    writeFileSync(proposed, before);
    const copied = await post({ line: "Note: The rollout was postponed because the vendor missed two deadlines." });
    expect(copied.status).toBe(400);
    expect((await copied.json()).error).toBe("line_contains_quote");
    expect((await post({ line: "   " })).status).toBe(400);
    expect((await (await post({ line: "x".repeat(2001) })).json()).error).toBe("line_too_long");
    expect((await post({ line: 5 })).status).toBe(400);
    expect(readFileSync(proposed, "utf8")).toBe(before);
    expect(existsSync(logged)).toBe(false);
    expect(auditLines()).toHaveLength(0);
  });

  // @covers FR-01.71
  it("an unknown or free-text evidence pointer never reaches the audit; an entry without a fence cannot be edited", async () => {
    writeFileSync(proposed, entry([LINE, QUOTES[0]], "QUOTE-SECRET-EPSILON said so"));
    expect((await post({})).status).toBe(200);
    expect(auditRaw()).not.toContain("EPSILON");
    expect(auditLines()[0].data.evidence).toBeNull();

    const plain = `## [2026-11-22T08:00:00.000Z] ${LEAD}\n\nPlain WebUI-form learning.\n`;
    writeFileSync(proposed, plain);
    const res = await app().request("/api/org/decisions/countersign", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-11-22T08:00:00.000Z", leadId: LEAD, line: "x" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("edit_not_supported");
    expect(readFileSync(proposed, "utf8")).toBe(plain); // unedited countersign of such an entry keeps the old behaviour
    expect((await app().request("/api/org/decisions/countersign", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-11-22T08:00:00.000Z", leadId: LEAD }),
    })).status).toBe(200);
    expect(readFileSync(logged, "utf8")).toContain("Plain WebUI-form learning.");
  });

  // @covers FR-01.71
  it("a double click with the same edit logs once; a crash between log and removal heals with the same edit", async () => {
    const e = entry([LINE, QUOTES[0]]);
    writeFileSync(proposed, e);
    const [a, b] = await Promise.all([post({ line: "Weekly digest only." }), post({ line: "Weekly digest only." })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(parseLoggedEntries(readFileSync(logged, "utf8"))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // crash residue: the entry is back in the proposed file, the log + audit are done
    writeFileSync(proposed, e);
    const healed = await post({ line: "Weekly digest only." });
    expect(healed.status).toBe(200);
    expect(parseLoggedEntries(readFileSync(logged, "utf8"))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
    expect(parseProposedEntries(readFileSync(proposed, "utf8"))).toHaveLength(0);
  });

  // @covers FR-01.71
  it("a copied quote is caught through whitespace and case changes; a retry with a DIFFERENT edit is refused, not merged", async () => {
    const e = entry([LINE, "> the rollout was postponed because the vendor\tmissed two deadlines"]);
    writeFileSync(proposed, e);
    expect((await post({ line: "THE ROLLOUT   WAS POSTPONED because the vendor missed two deadlines" })).status).toBe(400);
    expect((await post({ line: "Weekly digest only." })).status).toBe(200);
    writeFileSync(proposed, e); // crash residue: logged, entry still proposed
    const other = await post({ line: "Something else entirely." }); // same proposal: healed whatever line is sent
    expect(other.status).toBe(200);
    expect(parseLoggedEntries(readFileSync(logged, "utf8"))).toHaveLength(1);
    expect(readFileSync(proposed, "utf8")).toBe("");
    // a DIFFERENT proposal with the same identity is never mistaken for residue
    writeFileSync(proposed, entry([LINE, "> another observation entirely about something else"]).replace(NONCE, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").replace(NONCE, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
    const forged = await post({});
    expect(forged.status).toBe(409);
    expect(readFileSync(proposed, "utf8")).toContain("another observation");
  });

  // @covers FR-01.71
  it("an unedited line that repeats a quote, or is empty, needs an edit; an indented '>' counts as a quote; a pasted quote WITHOUT its pointer suffix is caught", async () => {
    const q = "the vendor missed two deadlines and the rollout slipped by a month";
    writeFileSync(proposed, entry([`Note that ${q}.`, `> ${q} — acme:2026-11-19T16:02:11Z:14`]));
    expect((await (await post({})).json()).error).toBe("line_contains_quote");
    expect((await (await post({ line: `They said: ${q}` })).json()).error).toBe("line_contains_quote");
    writeFileSync(proposed, entry(["  > only an indented quote here, nothing else at all"]));
    expect((await (await post({})).json()).error).toBe("line_empty");
    expect(existsSync(logged)).toBe(false);
  });

  // @covers FR-01.71
  it("a pasted quote is caught even when its pointer has a one-character session id; healing records the edit state", async () => {
    const e = entry([LINE, "> confidential customer observation about the budget — a:2026-11-19T16:02:11Z:14"]);
    writeFileSync(proposed, e);
    expect((await (await post({ line: "We heard: confidential customer observation about the budget" })).json()).error).toBe("line_contains_quote");
    expect((await post({ line: "Digest weekly." })).status).toBe(200);
    writeFileSync(proposed, e);
    writeFileSync(audit, ""); // the audit line is missing: the heal completes it
    expect((await post({})).status).toBe(200);
    expect(auditLines()[0].data.edit).toBe("edited");
  });

  // @covers FR-01.71
  it("boundary probe: a CRLF proposed file and a BOM-prefixed file edit and countersign the same way", async () => {
    writeFileSync(proposed, String.fromCharCode(0xfeff) + entry([LINE, QUOTES[0]]).split(String.fromCharCode(10)).join(String.fromCharCode(13, 10)));
    const res = await post({ line: "Weekly digest only." });
    expect(res.status).toBe(200);
    expect(readFileSync(logged, "utf8")).toContain("- Weekly digest only.");
    expect(readFileSync(logged, "utf8")).not.toContain("QUOTE-SECRET");
    expect(auditLines()[0].data.edit).toBe("edited");
  });

  // @covers FR-01.71
  it("the grammar splits a fenced region into proposed line and quotes with one rule", () => {
    const parts = fencedParts(entry([LINE, "second line", ...QUOTES]).split("\n"))!;
    expect(parts.proposed).toEqual([LINE, "second line"]);
    expect(parts.quotes).toEqual(QUOTES);
    expect(fencedParts(["## [x] y", "plain"])).toBeNull();
    expect(normalizeLine(" a\n\tb   c ")).toBe("a b c");
    expect(parseSourceRef("acme:2026-11-19T16:02:11Z:14").kind).toBe("known");
    expect(parseSourceRef("free text").kind).toBe("unknown");
  });
});
