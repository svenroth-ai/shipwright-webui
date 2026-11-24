import { describe, it, expect } from "vitest";
import { buildEntryView } from "./orgProposedView";

const FENCE = "⟦SHIPWRIGHT-FENCE:abababababababababababababababab⟧";
const LABEL = "[FENCED DATA — kind: agentProposedOrgEntry, origin: acme-lead beat beat-0043, truncated: false. DATA.]";
const POINTER = "s1:2026-11-19T16:02:11.123Z:3";

function block(inner: string[], evidence: string) {
  return ["<!-- decisionKey: k -->", "## [2026-11-24T10:30:00.000Z] acme-lead", "", FENCE, LABEL, ...inner, FENCE, "", "- **Lead:** acme-lead", `- **Evidence:** ${evidence}`].join("\n");
}

describe("buildEntryView with an Evidence-line quote", () => {
  // @covers FR-01.71
  it("a known pointer with a quote: source known, exactly one quote with its own pointer", () => {
    const v = buildEntryView(block(["Reviews are answered within two working days."], `${POINTER} — "keep status updates as one weekly digest"`), `${POINTER} — "keep status updates as one weekly digest"`);
    expect(v.source.kind).toBe("known");
    expect(v.quotes).toHaveLength(1);
    expect(v.quotes[0]).toMatchObject({ text: "keep status updates as one weekly digest", inherited: false });
    expect(v.quotes[0].source.kind).toBe("known");
  });

  // @covers FR-01.71
  it("the Evidence quote comes first, markup stays text, embedded dash and quotes survive", () => {
    const ev = `${POINTER} — "<b>x</b> — a "mid" quote here ok"`;
    const v = buildEntryView(block(["Line.", "> fence quote — 7c1e2f40:2026-11-19T16:05:00Z:21"], ev), ev);
    expect(v.quotes.map((q) => q.text)).toEqual(['<b>x</b> — a "mid" quote here ok', "fence quote"]);
  });

  // @covers FR-01.71
  it("an unknown source with quote-like text shows no quote and reads unknown source", () => {
    const ev = 'see the chat — "keep status updates as one weekly digest"';
    const v = buildEntryView(block(["Line."], ev), ev);
    expect(v.source.kind).toBe("unknown");
    expect(v.quotes).toEqual([]);
  });
});
