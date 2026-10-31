import { describe, expect, it } from "vitest";
import { groupRunResult, resultButtonLabel, resultRowTitle } from "./missionActivityFeedResult";
import { deriveActivityFeed } from "./missionActivityFeed";
import { parseSessionJsonl } from "../external/session-parser";
import type { ActivityCard } from "./missionActivityFeedTypes";

const card = (p: Partial<ActivityCard>): ActivityCard => ({ kind: "implement", text: "", commands: [], ...p });

describe("groupRunResult (V2)", () => {
  // @covers FR-01.66
  it("folds evidence-only cards into ONE result item at the last card's position, ordered, delivery apart", () => {
    const items = groupRunResult([
      card({ kind: "implement", text: "Narration", commands: ["Edit: a.ts"] }),
      card({ kind: "review", text: "Reviewed", artifact: "review", status: "ok" }),
      card({ kind: "test", text: "Tests ok", artifact: "tests", status: "ok" }),
      card({ kind: "spec", text: "Req", artifact: "requirement", status: "ok" }),
      card({ kind: "delivery", text: "Merged", artifact: "commit" }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["card", "result"]);
    const result = items[1];
    if (result.type !== "result") throw new Error("expected result");
    expect(result.rows.map((r) => r.artifact)).toEqual(["tests", "requirement", "review"]);
    expect(result.delivery?.artifact).toBe("commit");
  });

  it("keeps a card with real narration/output/commands as a normal card with its own link", () => {
    const withDetail = card({ kind: "test", text: "FAIL", artifact: "tests", status: "err", detail: "1 failed" });
    const withCommands = card({ kind: "spec", text: "x", artifact: "spec", commands: ["Read: spec.md"] });
    const items = groupRunResult([withDetail, withCommands]);
    expect(items.every((i) => i.type === "card")).toBe(true);
  });

  it("only the LAST delivery closes the result; an earlier one and a truncated (textFull) row stay normal cards", () => {
    const items = groupRunResult([
      card({ kind: "delivery", text: "Phase done", artifact: "phase" }),
      card({ kind: "test", text: "cut…", textFull: "cut in full", artifact: "tests", status: "ok" }),
      card({ kind: "review", text: "ok", artifact: "review", status: "ok" }),
      card({ kind: "delivery", text: "Merged", artifact: "commit" }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["card", "card", "result"]);
    const result = items[2];
    if (result.type !== "result") throw new Error("expected result");
    expect(result.rows.map((r) => r.artifact)).toEqual(["review"]);
    expect(result.delivery?.artifact).toBe("commit");
  });

  it("returns plain card items when nothing folds", () => {
    expect(groupRunResult([card({ text: "a" }), card({ text: "b" })]).map((i) => i.type)).toEqual(["card", "card"]);
  });

  it("names rows and buttons after the target", () => {
    expect(resultRowTitle("requirement")).toBe("Requirements");
    expect(["tests", "requirement", "decisions", "review", "commit"].map(resultButtonLabel)).toEqual(["Tests", "Requirement", "Decision", "Review", "Commit"]);
  });
});

describe("deriveActivityFeed - hand-back and subrunner metadata (V2)", () => {
  const ev = (o: unknown) => JSON.stringify(o);
  const dispatch = ev({ type: "assistant", timestamp: "2026-10-31T10:00:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Review and merge M4 PR", subagent_type: "general-purpose" } }] } });
  const ack = ev({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Async agent launched successfully.\nagentId: a798d6e7922ba0bd9" }] } });
  const done = ev({ type: "user", timestamp: "2026-10-31T10:44:00Z", message: { role: "user", content: "<task-notification><task-id>a798d6e7922ba0bd9</task-id><status>completed</status><summary>s</summary><result>R</result></task-notification>" } });
  const hand = ev({ type: "user", timestamp: "2026-10-31T10:44:01Z", message: { role: "user", content: "Another Claude session sent a message:\n<agent-message from=\"a798d6e7922ba0bd9\">\n[Subagent hand-back] x. The report follows:\n  All merged.\n</agent-message>" } });

  it("emits a handback card (not a user card) titled by its dispatch, and records type + end time on the subrunner", () => {
    const feed = deriveActivityFeed(parseSessionJsonl([dispatch, ack, done, hand].join("\n")).events, null);
    expect(feed.cards.some((c) => c.kind === "user")).toBe(false);
    const hb = feed.cards.find((c) => c.kind === "handback")!;
    expect(hb).toMatchObject({ text: "All merged.", handbackSender: "a798d6e7922ba0bd9", handbackOrigin: "subagent", handbackTitle: "Review and merge M4 PR" });
    const sub = feed.cards.find((c) => c.kind === "subrunner")!;
    expect(sub).toMatchObject({ subrunnerType: "general-purpose", subrunnerStatus: "done", subrunnerEndedAt: "2026-10-31T10:44:00Z" });
  });
});

describe("groupRunResult - latest per artifact", () => {
  it("folds only the latest card per artifact; the superseded one stays where it happened", () => {
    const items = groupRunResult([
      card({ kind: "test", text: "failed", artifact: "tests", status: "err" }),
      card({ kind: "implement", text: "fixed it" }),
      card({ kind: "test", text: "passes", artifact: "tests", status: "ok" }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["card", "card", "result"]);
    const result = items[2];
    if (result.type !== "result") throw new Error("expected result");
    expect(result.rows.map((r) => r.status)).toEqual(["ok"]);
  });
});
