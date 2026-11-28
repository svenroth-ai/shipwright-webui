import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseProposedDecisions } from "./orgDecisionsApi";
import { buildEntryView, describeSource, parseSourceRef } from "./orgProposedView";

// The pinned leadwright renderEntry sample for the file-line and journal-event evidence forms (leadwright d5c9ae01,
// #149), read as bytes so the client mirror is checked against the same file as the server suite.
const SAMPLE = readFileSync(
  path.resolve(__dirname, "../../../server/src/external/org/__tests__/fixtures/decisions-proposed-renderentry-evidence-forms-sample.md"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("entry view of the file-line and journal-event evidence forms", () => {
  const [fileEntry, eventEntry] = parseProposedDecisions(SAMPLE);

  // @covers FR-01.71
  it("lists both pinned entries", () => {
    expect([fileEntry?.timestamp, eventEntry?.timestamp]).toEqual(["2026-11-27T09:15:00.000Z", "2026-11-27T10:30:00.000Z"]);
  });

  // @covers FR-01.71
  it("a file pointer reads as project, path and line; its quote is shown first with that source", () => {
    const v = buildEntryView(fileEntry.block, fileEntry.evidence);
    expect(v.source).toEqual({ kind: "file", project: "dinovo GmbH", path: ["Projekte", "Q4 Plan.md"], line: 3 });
    expect(describeSource(v.source)).toBe("dinovo GmbH · Projekte/Q4 Plan.md · line 3");
    expect(v.quotes).toEqual([{ text: "answered within two working days", source: v.source, inherited: false }]);
    expect(v.proposedLine).toBe("Reviews are answered within two working days.");
  });

  // @covers FR-01.71
  it("an event pointer reads as its event id; its quote is shown first with that source", () => {
    const v = buildEntryView(eventEntry.block, eventEntry.evidence);
    expect(describeSource(v.source)).toBe("event evt-2026-11-27-001");
    expect(v.quotes).toEqual([{ text: "release branch be merged before the freeze", source: v.source, inherited: false }]);
  });

  // @covers FR-01.71
  it("decoded text that looks like markup or a URL stays plain text; a malformed pointer stays unknown", () => {
    expect(describeSource(parseSourceRef("event:%3Ca%20href%3D%22x%22%3Eclick%3C%2Fa%3E"))).toBe('event <a href="x">click</a>');
    expect(describeSource(parseSourceRef("file:https/example.com/x#L1"))).toBe("https · example.com/x · line 1");
    expect(describeSource(parseSourceRef("file:p/con#L1"))).toBe("unknown source");
    expect(describeSource(parseSourceRef("7c1e2f40:2026-11-19T16:02:11Z:14"))).toBe("session 7c1e2f40, 2026-11-19T16:02:11Z, message 14");
  });

  // @covers FR-01.71
  it("the Evidence-line quote stays first; an unchecked fence-quote file or event pointer reads as unknown source", () => {
    const block = fileEntry.block.replace("Reviews are answered", "> the freeze holds — event:evt-1\n> we churn — file:dinovo%20GmbH/Vertrag.md#L12\nReviews are answered");
    const v = buildEntryView(block, fileEntry.evidence);
    expect(v.quotes.map((q) => q.text)).toEqual(["answered within two working days", "the freeze holds", "we churn"]);
    expect(v.quotes[0].source).toEqual({ kind: "file", project: "dinovo GmbH", path: ["Projekte", "Q4 Plan.md"], line: 3 });
    expect(v.quotes[1]).toEqual({ text: "the freeze holds", source: { kind: "unknown", raw: "event:evt-1" }, inherited: false });
    expect(v.quotes[2].source).toEqual({ kind: "unknown", raw: "file:dinovo%20GmbH/Vertrag.md#L12" });
    // a session pointer on a fence quote keeps its existing reading
    const s = buildEntryView(fileEntry.block.replace("Reviews are answered", "> x — 7c1e2f40:2026-11-19T16:05:00Z:21\nReviews are answered"), fileEntry.evidence);
    expect(s.quotes[1].source.kind).toBe("known");
  });
});
