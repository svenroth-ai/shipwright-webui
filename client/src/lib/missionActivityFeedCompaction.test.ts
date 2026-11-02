import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { compactSummaryBody, isCompactSummaryContent } from "../external/parsers/compact-summary";
import { deriveActivityFeed } from "./missionActivityFeed";

const ev = (value: unknown) => JSON.stringify(value);
const boundary = ev({ type: "system", subtype: "compact_boundary", content: "Context automatically compacted" });
const SUMMARY = "<artifact-content-authored-by-others/> The summarized conversation below covers the earlier work.\n\nSummary:\n1. Primary request: **fix the viewer**\n2. Files: a.ts";
const summaryUser = (extra: Record<string, unknown> = {}) => ev({ type: "user", ...extra, message: { role: "user", content: SUMMARY } });
const human = ev({ type: "user", message: { role: "user", content: "Continue please" } });
const feedOf = (...lines: string[]) => deriveActivityFeed(parseSessionJsonl(lines.join("\n")).events, null);

// @covers FR-01.66
describe("context compaction in the Mission feed", () => {
  it("boundary + flagged summary => ONE collapsed system row with the summary, never a user card", () => {
    const { cards } = feedOf(boundary, summaryUser({ isCompactSummary: true }), human);
    expect(cards.map((c) => c.kind)).toEqual(["system", "user"]);
    expect(cards[0]).toMatchObject({ text: "Context compacted" });
    expect(cards[0]!.compactSummary).toContain("1. Primary request");
    expect(cards[0]!.compactSummary).not.toContain("artifact-content-authored-by-others");
    expect(cards[0]!.compactSummary).not.toContain("The summarized conversation");
    expect(cards[1]!.text).toBe("Continue please");
  });

  it("an older log without the flag is recognised by the framing fingerprint", () => {
    const { cards } = feedOf(boundary, summaryUser());
    expect(cards.filter((c) => c.kind === "user")).toHaveLength(0);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.compactSummary).toBeTruthy();
  });

  it("a summary without a preceding boundary still becomes its own system row", () => {
    const { cards } = feedOf(summaryUser({ isCompactSummary: true }));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "system", text: "Context compacted" });
  });

  it("a boundary alone stays a plain row with no summary", () => {
    const { cards } = feedOf(boundary);
    expect(cards[0]).toMatchObject({ kind: "system", text: "Context compacted" });
    expect(cards[0]!.compactSummary).toBeUndefined();
  });

  it("the classic continuation framing is also a summary; a normal human message is not", () => {
    expect(isCompactSummaryContent("This session is being continued from a previous conversation that ran out of context.\n\nSummary:\nx", false)).toBe(true);
    expect(isCompactSummaryContent("Please summarize the conversation", false)).toBe(false);
    expect(isCompactSummaryContent("anything", true)).toBe(true);
    expect(compactSummaryBody("This session is being continued...\n\nSummary:\nBody here")).toBe("Body here");
  });

  it("the parser keeps the CLI flag on the user event", () => {
    const e = parseSessionJsonl(summaryUser({ isCompactSummary: true })).events[0]!;
    expect(e).toMatchObject({ kind: "user", isCompactSummary: true });
  });
});
