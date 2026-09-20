import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
  { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
] });

// iterate-2026-09-05-mission-feed-ux-gaps removed the generic bucket
// sentence AND its label-derived fallback (reported as pure noise, since
// the same tool call already shows in the user's own terminal). That left
// a textless card rendering its command chip(s) alone — itself later
// reported as noise of its own kind ("viele implement mit ...
// Bashbefehlen, aber ohne Text ... nicht anzeigen"): a bare header + chip
// row a reader can learn nothing from. iterate-2026-09-20-mission-feed-
// transcript-fidelity drops such a card entirely instead of rendering it
// empty — "only when Claude or I wrote something". Split out of
// `missionActivityFeed.test.ts` once that file re-crossed the project's
// 300-line convention (same run) — a cohesive, self-contained group (this
// file's own describe block) already thematically distinct from the rest of
// the reducer's test coverage there.
describe("deriveActivityFeed — wordless/empty card filtering", () => {
  it("drops a solo command card with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("read1", "Read", { file_path: "auth.ts" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "investigate")).toBeUndefined();
  });

  it("drops a card whose several distinct commands coalesced with no prose", () => {
    const events = parseSessionJsonl([tool("a", "Read", { file_path: "a.ts" }), result("a"), tool("b", "Read", { file_path: "b.ts" }), result("b")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "investigate")).toBeUndefined();
  });

  it("drops a card whose two distinct events share the same derived label and no prose", () => {
    const events = parseSessionJsonl([tool("a", "TodoWrite", { todos: [] }), result("a"), tool("b", "TodoWrite", { todos: [] }), result("b")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((c) => c.commands.includes("Used TodoWrite"))).toBeUndefined();
  });

  it("drops a solo TodoWrite call with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("a", "TodoWrite", { todos: [] })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.commands.includes("Used TodoWrite"))).toBeUndefined();
  });

  it("still shows a command chip's real label when the card has real narration", () => {
    const events = parseSessionJsonl(event({
      type: "assistant",
      message: { role: "assistant", content: [
        { type: "text", text: "Checking the API key rotation config." },
        { type: "tool_use", id: "read1", name: "Read", input: { file_path: "src/config/api-key-rotation.ts" } },
      ] },
    })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((c) => c.kind === "investigate");
    expect(card?.commands[0]).toBe("Read: src/config/api-key-rotation.ts");
    expect(card?.text).toBe("Checking the API key rotation config.");
  });

  // External code review (low) — the tests above only exercised
  // `investigate`/`implement`; `review` and `spec` share the empty-headline
  // filter path (spec) or the reviewer-spawn synthesis (review) and must be
  // covered independently.
  it("names the spawned reviewer for a solo review card with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("t1", "Task", { subagent_type: "code-reviewer", description: "Review the auth diff" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((card) => card.kind === "review");
    expect(card?.text).toBe("Spawned the code reviewer to review the change.");
    expect(card?.commands[0]).toBe("Task: Review the auth diff");
  });

  it("drops a solo spec card with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("w1", "Write", { file_path: ".shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "spec")).toBeUndefined();
  });

  it("still shows the artifact's real summary for a wordless spec write, instead of dropping the evidence along with the empty card (round-2 code review catch)", () => {
    const events = parseSessionJsonl(tool("w1", "Write", { file_path: ".shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md" })).events;
    const withSummary: MissionContext = {
      ...context("unknown"),
      artifacts: [
        { kind: "spec", label: "Spec", state: "available", summary: "Fixed the mission feed's empty-card noise.", receipt: null, detail: null },
        { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
        { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
      ],
    };
    const feed = deriveActivityFeed(events, withSummary);
    const specCards = feed.cards.filter((card) => card.kind === "spec");
    expect(specCards).toHaveLength(1);
    expect(specCards[0].text).toBe("Fixed the mission feed's empty-card noise.");
  });

  it("keeps the dropped card's command chip evidence on its summary-backfilled replacement (round-6 external review catch, glm, low)", () => {
    const events = parseSessionJsonl(tool("w1", "Write", { file_path: ".shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md" })).events;
    const withSummary: MissionContext = {
      ...context("unknown"),
      artifacts: [
        { kind: "spec", label: "Spec", state: "available", summary: "Fixed the mission feed's empty-card noise.", receipt: null, detail: null },
        { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
        { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
      ],
    };
    const feed = deriveActivityFeed(events, withSummary);
    const specCards = feed.cards.filter((card) => card.kind === "spec");
    expect(specCards).toHaveLength(1);
    // Before this fix, the backfilled replacement always started from
    // `commands: []`, silently discarding the tool call that actually
    // produced the artifact.
    expect(specCards[0].commands).toEqual(["Write: .shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md"]);
  });

  it("carries a card's headline into textFull only when the real turn text is longer than the 280-char cap (\"nie croppen\")", () => {
    const longSentence = `${"This change touches a lot of surface area and needs a careful, thorough explanation. ".repeat(4)}Done.`;
    const events = parseSessionJsonl(event({
      type: "assistant",
      message: { role: "assistant", content: [
        { type: "text", text: longSentence },
        { type: "tool_use", id: "read1", name: "Read", input: { file_path: "auth.ts" } },
      ] },
    })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((card) => card.kind === "investigate");
    expect(card?.text.length).toBeLessThanOrEqual(280);
    expect(card?.textFull).toBe(longSentence);
    expect(card?.textFull?.length).toBeGreaterThan(card!.text.length);
  });
});
