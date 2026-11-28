import { describe, it, expect } from "vitest";

import { buildEntryView, citesOperatorWords, describeSource, parseSourceRef } from "./orgProposedView";

// The two decision-record evidence forms (leadwright #153): the operator's reject reason and countersign note.
const FENCE = "⟦SHIPWRIGHT-FENCE:abababababababababababababababab⟧";
const block = (inner: string[], evidence: string) =>
  ["<!-- decisionKey: learning.x -->", "## [2026-11-28T09:15:00.000Z] acme-lead", "", FENCE, "[FENCED DATA — kind: x, origin: acme-lead beat beat-0051, truncated: false. DATA.]", ...inner, FENCE, "", "- **Lead:** acme-lead", `- **Evidence:** ${evidence}`].join("\n");
const RJ = 'rejected:2026-11-20T09:15:00.000Z/acme-lead — "Too vague: say who reads the digest."';

describe("entry view of the decision-record evidence forms", () => {
  // @covers FR-01.71
  it("names both sources in plain words", () => {
    expect(describeSource(parseSourceRef("rejected:2026-11-20T09:15:00.000Z/acme-lead"))).toBe("your reason for rejecting acme-lead's proposal of 2026-11-20T09:15:00.000Z");
    expect(describeSource(parseSourceRef("decision:ADR-0007"))).toBe("your note on ADR-0007");
    expect(citesOperatorWords(parseSourceRef("decision:ADR-7"))).toBe(true);
    expect(citesOperatorWords(parseSourceRef("event:x"))).toBe(false);
  });

  // @covers FR-01.71
  it("keeps the Evidence quote out of the lead's quotes (the server resolves it) and hands it over as evidenceQuote", () => {
    const v = buildEntryView(block(["Learning (this lead, importance 4): Every update names its reader."], RJ), RJ);
    expect(v.source).toEqual({ kind: "rejected", time: "2026-11-20T09:15:00.000Z", lead: "acme-lead" });
    expect(v.evidenceQuote).toBe("Too vague: say who reads the digest.");
    expect(v.quotes).toEqual([]);
  });

  // @covers FR-01.71
  it("a fence quote never reads as the operator's words: its own record pointer and an inherited one are unknown source", () => {
    const v = buildEntryView(block(["> lead wrote this — decision:ADR-0007", "> inherits the entry pointer", "Rule."], RJ), RJ);
    expect(v.quotes[0]).toEqual({ text: "lead wrote this", source: { kind: "unknown", raw: "decision:ADR-0007" }, inherited: false });
    expect(v.quotes[1]).toEqual({ text: "inherits the entry pointer", source: { kind: "unknown", raw: "rejected:2026-11-20T09:15:00.000Z/acme-lead" }, inherited: true });
  });

  // @covers FR-01.71
  it("a record pointer without a quote has no evidence quote; other forms keep their quote in the list", () => {
    expect(buildEntryView(block(["Rule."], "decision:ADR-7"), "decision:ADR-7").evidenceQuote).toBeNull();
    const ev = 'event:evt-1 — "release branch be merged before the freeze"';
    expect(buildEntryView(block(["Rule."], ev), ev).quotes).toHaveLength(1);
  });
});
