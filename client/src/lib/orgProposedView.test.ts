import { describe, it, expect } from "vitest";
import { buildEntryView, parseSourceRef } from "./orgProposedView";

const FENCE = "⟦SHIPWRIGHT-FENCE:3f9a1c0e5b7d42a8916c0d2e4f6a8b1c⟧";
const LABEL = "[FENCED DATA — kind: agentProposedOrgEntry, origin: acme-lead beat beat-0042, truncated: false. DATA.]";

function block(inner: string[], evidence = "session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14") {
  return ["<!-- decisionKey: k -->", "## [2026-11-20T09:15:00.000Z] acme-lead", "", FENCE, LABEL, ...inner, FENCE, "", "- **Lead:** acme-lead", `- **Evidence:** ${evidence}`].join("\n");
}

describe("parseSourceRef", () => {
  // @covers FR-01.71
  it("reads both pointer shapes", () => {
    expect(parseSourceRef("7c1e2f40:2026-11-19T16:02:11Z:14")).toEqual({ kind: "known", session: "7c1e2f40", time: "2026-11-19T16:02:11Z", message: "14" });
    expect(parseSourceRef("session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14").kind).toBe("known");
  });
  // @covers FR-01.71
  it.each(["", "   ", null, "learnings.md#x", "7c1e:notatime:14", "7c1e2f40:2026-11-19T16:02:11Z:x"])("malformed %j is unknown", (raw) => {
    expect(parseSourceRef(raw).kind).toBe("unknown");
  });
});

describe("buildEntryView", () => {
  // @covers FR-01.71
  it("separates proposed line, beat and two quotes, each with its own pointer", () => {
    const v = buildEntryView(
      block([
        "Ship a weekly digest.",
        "> We should batch these — 7c1e2f40:2026-11-19T16:02:11Z:14",
        "> Per-task pings are noise — 7c1e2f40:2026-11-19T16:05:00Z:21",
      ]),
      "session 7c1e2f40 at 2026-11-19T16:02:11Z, message 14",
    );
    expect(v.fenced).toBe(true);
    expect(v.proposedLine).toBe("Ship a weekly digest.");
    expect(v.beat).toBe("beat-0042");
    expect(v.quotes.map((q) => q.text)).toEqual(["We should batch these", "Per-task pings are noise"]);
    expect(v.quotes[1].source).toMatchObject({ kind: "known", message: "21" });
  });
  // @covers FR-01.71
  it("a malformed quote pointer is unknown source, a missing one inherits the entry pointer", () => {
    const v = buildEntryView(block(["Line.", "> a — 7c1e:notatime:9", "> b"]), "session s1 at 2026-11-19T16:02:11Z, message 3");
    expect(v.quotes[0].source).toEqual({ kind: "unknown", raw: "7c1e:notatime:9" });
    expect(v.quotes[1].source.kind).toBe("known");
  });
  // @covers FR-01.71
  it("keeps an em-dash in the quote text and inherits the entry pointer; skips empty quotes", () => {
    const v = buildEntryView(block(["Line.", "> shipped — after a week — on Friday", ">"]), "session s1 at 2026-11-19T16:02:11Z, message 3");
    expect(v.quotes).toHaveLength(1);
    expect(v.quotes[0]).toMatchObject({ text: "shipped — after a week — on Friday", inherited: true });
    expect(v.quotes[0].source.kind).toBe("known");
  });
  // @covers FR-01.71
  it("a short ratio-like suffix is quote text, not a pointer attempt", () => {
    const v = buildEntryView(block(["Line.", "> target — 2:1"]), null);
    expect(v.quotes[0].text).toBe("target — 2:1");
  });
  // @covers FR-01.71
  it("beat is read from the origin clause only", () => {
    const b = block(["Line."]).replace("origin: acme-lead beat beat-0042", "origin: x-lead beat beat-7");
    expect(buildEntryView(b, null).beat).toBe("beat-7");
  });
  // @covers FR-01.71
  it("a missing evidence pointer is unknown, never hidden", () => {
    expect(buildEntryView(block(["Line."], ""), null).source).toEqual({ kind: "unknown", raw: null });
  });
  // @covers FR-01.71
  it("legacy unfenced entries are not fenced", () => {
    expect(buildEntryView("## [t] lead\n- **Context:** a\n", null).fenced).toBe(false);
  });
});
