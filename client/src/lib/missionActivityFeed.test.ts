import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";
import { fixtureContext, longIterateFixture, releaseFixture, shortSecurityFixture } from "./missionActivityFeed.fixtures";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
  { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed", () => {
  it("never renders compaction as a card of its own kind other than system", () => {
    const events = parseSessionJsonl([event({ type: "system", content: "Context automatically compacted" }), event({ type: "user", message: { role: "user", content: "Make the feed useful" } })].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.some((card) => card.kind === "system")).toBe(true);
  });

  it("does not create a green test result from a shell result", () => {
    const events = parseSessionJsonl([tool("test", "Bash", { command: "npm test" }), result("test")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "test")?.text).toBe("No reliable test result is recorded.");
    expect(feed.cards.find((card) => card.kind === "test")?.commands).toContain("Bash: npm test");
  });

  it("ignores a stale result that appears before its matching tool call", () => {
    const events = parseSessionJsonl([result("test"), tool("test", "Bash", { command: "npm test" })].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    expect(feed.cards.find((card) => card.kind === "test")?.text).toMatch(/needs attention/i);
  });

  it("does not let a durable earlier pass green an unverified background command", () => {
    const events = parseSessionJsonl([tool("test", "Bash", { command: "npm test", run_in_background: true }), result("test")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    expect(feed.cards.find((card) => card.kind === "test")?.text).toMatch(/needs attention/i);
  });

  it("does not hide an earlier pending test behind a later completed command", () => {
    const events = parseSessionJsonl([tool("first", "Bash", { command: "npm test" }), tool("second", "Bash", { command: "npm test" }), result("second")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    expect(feed.cards.filter((card) => card.kind === "test").at(-1)?.text).toMatch(/needs attention/i);
  });

  it("keeps a short security run honest when its test gate fails", () => {
    expect(deriveActivityFeed(shortSecurityFixture, fixtureContext("fail")).cards.find((card) => card.kind === "test")?.text).toMatch(/needs attention/i);
  });

  it("renders a release from durable artifacts without a transcript", () => {
    const feed = deriveActivityFeed([], releaseFixture);
    expect(feed.outcome).toBe("Completed run");
    expect(feed.cards.find((card) => card.kind === "delivery")?.artifact).toBe("phase");
  });

  it("does not call a live run complete merely because it already has a commit", () => {
    expect(deriveActivityFeed([], context("pass", true)).outcome).toBe("In progress");
  });

  it("ignores a continuation prompt and surfaces input and unresolved command blockers", () => {
    const events = parseSessionJsonl([event({ type: "user", message: { role: "user", content: "This session is being continued from a previous conversation. Summary below." } }), tool("ask", "AskUserQuestion", { questions: [] }), tool("blocked", "Bash", { command: "git push" }), result("blocked", true)].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.map((card) => card.kind)).toEqual(expect.arrayContaining(["user-input", "blocker"]));
  });

  it("coalesces a 900-tool iterate into a short feed and preserves system-marker order", () => {
    const feed = deriveActivityFeed(longIterateFixture, fixtureContext("unknown"));
    expect(feed.cards.length).toBeLessThanOrEqual(6);
    expect(feed.cards.findIndex((card) => card.kind === "system")).toBeGreaterThan(0);
  });

  it("keeps a later unresolved failure from being reported as a pass", () => {
    const events = parseSessionJsonl([tool("test", "Bash", { command: "npm test" }), result("test", true)].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    expect(feed.cards.find((card) => card.kind === "test")?.text).toMatch(/needs attention/i);
  });

  it("requires a verified retry before a failed test episode can recover", () => {
    const failed = parseSessionJsonl([tool("first", "Bash", { command: "npm test" }), result("first", true)].join("\n")).events;
    expect(deriveActivityFeed(failed, context("pass")).cards.find((card) => card.kind === "test")?.text).toMatch(/needs attention/i);
    const recovered = parseSessionJsonl([tool("first", "Bash", { command: "npm test" }), result("first", true), tool("retry", "Bash", { command: "npm test" }), result("retry")].join("\n")).events;
    expect(deriveActivityFeed(recovered, context("pass")).cards.filter((card) => card.kind === "test").at(-1)?.text).toMatch(/recovered/i);
  });

  it("keeps a new test failure unresolved after an earlier recovery", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "npm test" }), result("first", true),
      tool("retry", "Bash", { command: "npm test" }), result("retry"),
      tool("last", "Bash", { command: "npm test" }), result("last", true),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("pass")).cards.filter((card) => card.kind === "test");
    expect(cards.at(-1)?.text).toMatch(/needs attention/i);
    expect(cards.some((card) => /recovered/i.test(card.text))).toBe(true);
  });

  it("coalesces a recovered non-test blocker into one finished episode", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "git push" }), result("first", true),
      tool("retry", "Bash", { command: "git push" }), result("retry"),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("unknown")).cards;
    expect(cards.filter((card) => card.kind === "blocker")).toHaveLength(0);
    expect(cards.find((card) => /recovered/i.test(card.text))?.kind).toBe("implement");
  });

  it("promotes a running review card when durable review evidence is available", () => {
    const reviewContext = {
      ...context("unknown"),
      artifacts: [...context("unknown").artifacts, { kind: "review" as const, label: "Review", state: "available" as const, summary: null, receipt: null, detail: null }],
    };
    const events = parseSessionJsonl(tool("review", "Task", { description: "Review the change" })).events;
    expect(deriveActivityFeed(events, reviewContext).cards.find((card) => card.kind === "review")?.text).toMatch(/recorded review/i);
  });

  it("provides an artifact-only completed feed without inventing transcript work", () => {
    const feed = deriveActivityFeed([], context("pass", false));
    expect(feed.outcome).toBe("Completed run");
    expect(feed.cards.find((card) => card.kind === "delivery")?.artifact).toBe("commit");
    expect(feed.cards.some((card) => card.kind === "implement")).toBe(false);
  });

  it("keeps the final delivery link when work_completed has no commit or PR yet", () => {
    const requirementDetail = {
      type: "requirements" as const,
      confidence: "finalized" as const,
      lifecycle: "recorded" as const,
      rows: [],
      specImpact: "modify",
      sourceDocument: null,
    };
    const completedWithoutCommit = {
      ...context("pass", false),
      artifacts: context("pass", false).artifacts.map((item) => item.kind === "commit"
        ? { ...item, state: "not_yet_created" as const }
        : item.kind === "requirement" ? { ...item, detail: requirementDetail } : item),
    };
    const feed = deriveActivityFeed([], completedWithoutCommit);
    expect(feed.outcome).toBe("Completed run");
    expect(feed.cards.find((card) => card.kind === "delivery")?.artifact).toBe("commit");
  });

  it("does not treat a planned no-requirement change as work_completed", () => {
    const unfinished = {
      ...context("unknown", false),
      tests: null,
      artifacts: context("unknown", false).artifacts.map((item) => item.kind === "requirement" ? {
        ...item,
        detail: { type: "requirements" as const, confidence: "unresolved" as const, lifecycle: "none" as const, rows: [], specImpact: "none", sourceDocument: null },
      } : item),
    };
    expect(deriveActivityFeed([], unfinished).outcome).toBe("Waiting for reliable evidence");
  });

  it("turns answered user input into a resolved historical episode", () => {
    const events = parseSessionJsonl([tool("ask", "AskUserQuestion", { questions: [] }), result("ask")].join("\n")).events;
    expect(deriveActivityFeed(events, context("unknown")).cards.find((card) => card.kind === "user-input")?.text).toMatch(/received/i);
  });

  it("keeps a second unanswered user-input episode open", () => {
    const events = parseSessionJsonl([tool("first", "AskUserQuestion", { questions: [] }), tool("second", "AskUserQuestion", { questions: [] }), result("first")].join("\n")).events;
    const cards = deriveActivityFeed(events, context("unknown")).cards.filter((card) => card.kind === "user-input");
    expect(cards).toHaveLength(2);
    expect(cards.some((card) => /needed/i.test(card.text))).toBe(true);
  });

  it("does not confuse an unrelated successful read with a failed read retry", () => {
    const events = parseSessionJsonl([tool("a", "Read", { file_path: "a.ts" }), result("a", true), tool("b", "Read", { file_path: "b.ts" }), result("b")].join("\n")).events;
    expect(deriveActivityFeed(events, context("unknown")).cards.some((card) => card.kind === "blocker")).toBe(true);
  });

  it("prefers the turn's own explanation over the generic bucket sentence (iterate-2026-08-13-mission-mobile-visual)", () => {
    const events = parseSessionJsonl(event({
      type: "assistant",
      message: { role: "assistant", content: [
        { type: "text", text: "Checking how the auth guard handles a stale token." },
        { type: "tool_use", id: "read1", name: "Read", input: { file_path: "auth.ts" } },
      ] },
    })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "investigate")?.text).toBe("Checking how the auth guard handles a stale token.");
  });

  it("derives a label-based sentence from a solo command when the turn carries no explanation", () => {
    const events = parseSessionJsonl(tool("read1", "Read", { file_path: "auth.ts" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "investigate")?.text).toBe("Read auth.ts.");
  });

  it("keeps the fully-generic sentence when several distinct commands coalesce into one card", () => {
    const events = parseSessionJsonl([tool("a", "Read", { file_path: "a.ts" }), result("a"), tool("b", "Read", { file_path: "b.ts" }), result("b")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "investigate")?.text).toBe("The existing behaviour was examined before changes were made.");
  });

  it("keeps the fully-generic sentence when two distinct events share the same derived label", () => {
    const events = parseSessionJsonl([tool("a", "TodoWrite", { todos: [] }), result("a"), tool("b", "TodoWrite", { todos: [] }), result("b")].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((c) => c.commands.includes("Used TodoWrite"));
    expect(card?.text).toBe("The implementation was updated in compact steps.");
  });

  it("derives a sentence for a solo TodoWrite call with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("a", "TodoWrite", { todos: [] })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.commands.includes("Used TodoWrite"))?.text).toBe("Used TodoWrite.");
  });

  it("renders a token-like argument identically in the command chip and the promoted sentence", () => {
    const events = parseSessionJsonl(tool("read1", "Read", { file_path: "src/config/api-key-rotation.ts" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    const card = feed.cards.find((c) => c.kind === "investigate");
    expect(card?.commands[0]).toBe("Read: src/config/api-key-rotation.ts");
    expect(card?.text).toBe("Read src/config/api-key-rotation.ts.");
  });

  // External code review (low) — the second-tier fallback tests above only
  // exercised `investigate`/`implement`; `review` and `spec` share the same
  // backfill pass and must be covered independently.
  it("derives a label-based sentence for a solo review card with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("t1", "Task", { subagent_type: "code-reviewer", description: "Review the auth diff" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "review")?.text).toBe("Task Review the auth diff.");
  });

  it("derives a label-based sentence for a solo spec card with no explanatory prose", () => {
    const events = parseSessionJsonl(tool("w1", "Write", { file_path: ".shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md" })).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.find((card) => card.kind === "spec")?.text).toBe("Write .shipwright/planning/iterate/2026-08-22-mission-feed-fixes.md.");
  });
});
