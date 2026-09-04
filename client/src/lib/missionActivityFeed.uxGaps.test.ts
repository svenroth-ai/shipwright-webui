/*
 * iterate-2026-09-05-mission-feed-ux-gaps — six reported Mission Activity
 * Feed gaps on top of iterate-2026-08-31-mission-feed-gaps:
 *  1. no more generic bucket sentences for tool calls (own test file:
 *     missionActivityFeed.test.ts / .splitTurn.test.ts / .timestampAndBanner.test.ts)
 *  2/4. "nie croppen" — every bounded field gets an untruncated `xFull`
 *     counterpart, populated only when real truncation happened
 *  3. a long command chip can be inspected in full (`commandFullText`)
 *  5. a successful review tool_result's own content reaches `card.detail`
 *  6. the requirement/spec/decisions backfill card uses the server's real
 *     `summary`, not a hardcoded placeholder
 * Split into its own file (not folded into missionActivityFeedFields.test.ts,
 * already at 261 lines) to keep each file under the project's 300-line
 * convention.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const turn = (text: string, id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }, { type: "tool_use", id, name, input }] } });
const okResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
const errorResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
  { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed — never crop (iterate-2026-09-05-mission-feed-ux-gaps)", () => {
  it("carries a turn's explanation into explanationFull only when it is longer than the 600-char cap", () => {
    const longRest = `${"A relevant detail about this change. ".repeat(20)}Done.`;
    const events = parseSessionJsonl(turn(`Headline.\n${longRest}`, "r1", "Read", { file_path: "a.ts" })).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "investigate");
    // 600-char cap + a trailing ellipsis character on truncation (same
    // convention as excerpt()'s 320/321 in missionActivityFeedFields.test.ts).
    expect(card?.explanation?.length).toBeLessThanOrEqual(601);
    expect(card?.explanationFull).toBe(longRest);
  });

  it("does not set explanationFull when the real explanation already fits under the cap", () => {
    const events = parseSessionJsonl(turn("Headline.\nA short follow-up.", "r1", "Read", { file_path: "a.ts" })).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "investigate");
    expect(card?.explanation).toBe("A short follow-up.");
    expect(card?.explanationFull).toBeUndefined();
  });

  it("carries a failing test's raw output into detailFull only when it is longer than the 4-line/320-char excerpt", () => {
    const longOutput = Array.from({ length: 10 }, (_, i) => `line ${i}: ${"x".repeat(40)}`).join("\n");
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", longOutput)].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test");
    expect(card?.detail?.split("\n")).toHaveLength(4);
    expect(card?.detailFull).toBe(longOutput);
  });

  it("does not set detailFull when the raw output already fits under the excerpt caps", () => {
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", "short failure")].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test");
    expect(card?.detail).toBe("short failure");
    expect(card?.detailFull).toBeUndefined();
  });

  it("carries a long AskUserQuestion answer into answerFull only when it is longer than the bounded excerpt (reported: answers get cropped with no way to read the rest)", () => {
    const longAnswer = "This is a fairly detailed free-text answer. ".repeat(15);
    const events = parseSessionJsonl([
      tool("ask", "AskUserQuestion", { questions: [{ question: "Which approach?", options: [{ label: "A" }] }] }),
      okResult("ask", longAnswer),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.answer?.length).toBeLessThan(longAnswer.trim().length);
    expect(card?.question?.answerFull).toBe(longAnswer.trim());
  });

  it("does not set answerFull when the answer already fits under the excerpt cap", () => {
    const events = parseSessionJsonl([
      tool("ask", "AskUserQuestion", { questions: [{ question: "Which approach?", options: [{ label: "A" }] }] }),
      okResult("ask", "A short free-text answer."),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.answer).toBe("A short free-text answer.");
    expect(card?.question?.answerFull).toBeUndefined();
  });

  it("records a long Bash command's full text under commandFullText, keyed by its truncated chip label (reported: a long command could not be inspected past its preview)", () => {
    const longCommand = `npm run build -- --flag ${"x".repeat(200)}`;
    const events = parseSessionJsonl(tool("b", "Bash", { command: longCommand })).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "implement");
    const label = card?.commands[0];
    expect(label).toBeDefined();
    expect(label!.length).toBeLessThan(longCommand.length + "Bash: ".length);
    expect(card?.commandFullText?.[label!]).toBe(`Bash: ${longCommand}`);
  });

  it("does not add a commandFullText entry for a chip whose label already shows the full command", () => {
    const events = parseSessionJsonl(tool("b", "Bash", { command: "npm test" })).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test" || c.kind === "implement");
    expect(card?.commandFullText).toBeUndefined();
  });
});

describe("deriveActivityFeed — successful review tool_result surfaces its own content (issue #5)", () => {
  it("attaches a successful review tool_result's own content to card.detail, even with no durable review artifact", () => {
    const events = parseSessionJsonl([
      tool("rev", "Task", { subagent_type: "code-reviewer", description: "Review the auth diff" }),
      okResult("rev", "Verdict: approved.\nNo blocking findings."),
    ].join("\n")).events;
    // No "review" artifact in context — a one-off review with no
    // `record_review_pass.py` call, the exact gap this closes.
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "review");
    expect(card?.detail).toBe("Verdict: approved.\nNo blocking findings.");
  });

  it("still lets a later durable review artifact override the card's headline (reconcile stays authoritative)", () => {
    const events = parseSessionJsonl([
      tool("rev", "Task", { subagent_type: "code-reviewer", description: "Review the auth diff" }),
      okResult("rev", "Verdict: approved."),
    ].join("\n")).events;
    const reviewContext: MissionContext = {
      ...context("unknown"),
      artifacts: [...context("unknown").artifacts, { kind: "review", label: "Review", state: "available", summary: null, receipt: null, detail: null }],
    };
    const card = deriveActivityFeed(events, reviewContext).cards.find((c) => c.kind === "review");
    expect(card?.text).toBe("The recorded review evidence is available.");
    expect(card?.status).toBe("ok");
  });
});

describe("deriveActivityFeed — requirement/spec/decisions backfill uses the real summary (issue #6)", () => {
  it("uses the server's real requirement summary instead of the hardcoded placeholder", () => {
    const withSummary: MissionContext = {
      ...context("unknown", false),
      artifacts: [
        ...context("unknown", false).artifacts,
        { kind: "requirement", label: "Requirement", state: "available", summary: "Changed FR-02.14 (login rate limiting).", receipt: "FR-02.14", detail: null },
      ],
    };
    const feed = deriveActivityFeed([], withSummary);
    const card = feed.cards.find((c) => c.artifact === "requirement");
    expect(card?.text).toBe("Changed FR-02.14 (login rate limiting).");
    expect(card?.text).not.toBe("Requirement evidence is available.");
  });

  it("falls back to the placeholder only when the artifact carries no summary at all", () => {
    const noSummary: MissionContext = {
      ...context("unknown", false),
      artifacts: [
        ...context("unknown", false).artifacts,
        { kind: "requirement", label: "Requirement", state: "available", summary: null, receipt: "FR-02.14", detail: null },
      ],
    };
    const feed = deriveActivityFeed([], noSummary);
    const card = feed.cards.find((c) => c.artifact === "requirement");
    expect(card?.text).toBe("Requirement evidence is available.");
  });
});
