/*
 * iterate-2026-08-20-mission-feed-content — real per-kind content plus the
 * new `detail`/`status`/`question` fields. Split out of
 * `missionActivityFeed.test.ts` once that file crossed the project's
 * 300-line convention; shares the same small event-builder helpers by
 * design (they are ~10 lines each, not worth a shared module for two
 * test files).
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import { explanationExcerpt } from "./missionActivityFeedText";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] } });
const errorResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] } });
const okResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
  { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed — real content + detail/status/question fields", () => {
  it("attaches a bounded real-output excerpt and an err status to a failing test card", () => {
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", "FAIL src/x.test.ts\nexpect(received).toEqual(expected)")].join("\n")).events;
    const card = deriveActivityFeed(events, context("fail")).cards.find((c) => c.kind === "test");
    expect(card?.status).toBe("err");
    expect(card?.detail).toBe("FAIL src/x.test.ts\nexpect(received).toEqual(expected)");
  });

  it("never lets an unretried local failure contradict a recorded passing gate (external review catch, high)", () => {
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", "FAIL src/x.test.ts")].join("\n")).events;
    const card = deriveActivityFeed(events, context("pass")).cards.find((c) => c.kind === "test");
    // The pill follows the gate unconditionally...
    expect(card?.status).toBe("ok");
    // ...and no invented sentence papers over that (iterate-2026-09-05-
    // mission-feed-ux-gaps): the transcript's own turn wrote no narration,
    // so the card's text stays empty rather than claiming a recovery this
    // transcript never proved.
    expect(card?.text).toBe("");
    // ...and the stale FAIL excerpt from the unretried attempt must not keep
    // rendering under a pill that no longer says "Failing" (code review
    // catch, high — the gate override cleared status but not detail).
    expect(card?.detail).toBeUndefined();
  });

  it("derives the pending-test pill from the recorded gate instead of hardcoding warn (code review catch)", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "npm test" }), result("first"),
      tool("second", "Bash", { command: "npm test" }),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("fail")).cards.filter((c) => c.kind === "test").at(-1);
    expect(card?.status).toBe("err");
  });

  it("shows a warn pill, not err, when a locally-observed failure has no recorded gate (external review catch)", () => {
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", "FAIL src/x.test.ts")].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test");
    expect(card?.status).toBe("warn");
  });

  it("never shows a false-reassuring ok pill while an unrelated test card is still pending, even for a recovered gate:pass card (doubt-review catch, high)", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "npm test suiteA" }), // never resolves — stays "awaiting a result"
      tool("second", "Bash", { command: "npm test suiteB" }), errorResult("second", "FAIL suiteB"),
      tool("retry", "Bash", { command: "npm test suiteB" }), result("retry"),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("pass")).cards.filter((c) => c.kind === "test");
    // The still-open suiteA card means the run's test picture is not fully
    // settled, so the aggregate-latest card must not claim "ok"/Passing —
    // a green pill next to "needs attention" text would be a
    // self-contradiction (the original bug: this scenario used to overwrite
    // the just-recovered card's status straight from the gate, producing
    // exactly that false-reassuring pill).
    expect(cards.some((c) => c.status === "ok")).toBe(false);
    expect(cards.find((c) => c.text === "The latest test attempt needs attention.")?.status).toBe("warn");
  });

  it("preserves a bounded multi-line excerpt instead of collapsing it to one line (external review catch)", () => {
    const longOutput = ["FAIL src/x.test.ts", "  expect(received).toEqual(expected)", "  - Expected: 1", "  + Received: 2", "  extra ignored line"].join("\n");
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", longOutput)].join("\n")).events;
    const detail = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test")?.detail;
    expect(detail?.split("\n")).toHaveLength(4);
    expect(detail).not.toContain("extra ignored line");
  });

  it("marks a line-count-truncated excerpt with an ellipsis so a partial output is never silent (doubt-review catch)", () => {
    const longOutput = ["FAIL src/x.test.ts", "  line 2", "  line 3", "  line 4", "  line 5 dropped"].join("\n");
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", longOutput)].join("\n")).events;
    const detail = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test")?.detail;
    expect(detail?.endsWith("…")).toBe(true);
    expect(detail?.split("\n")).toHaveLength(4);
  });

  it("hard-caps a single long line to 320 chars with an ellipsis (Confidence Calibration probe)", () => {
    const longLine = "F".repeat(400);
    const events = parseSessionJsonl([tool("t", "Bash", { command: "npm test" }), errorResult("t", longLine)].join("\n")).events;
    const detail = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "test")?.detail;
    expect(detail).toHaveLength(321);
    expect(detail?.endsWith("…")).toBe(true);
  });

  it("clears the stale status/detail pill when a blocker recovers (internal plan review, finding 7)", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "npm run build" }), errorResult("first", "Error: something broke"),
      tool("retry", "Bash", { command: "npm run build" }), result("retry"),
    ].join("\n")).events;
    const recovered = deriveActivityFeed(events, context("unknown")).cards.find((card) => /recovered/i.test(card.text));
    expect(recovered?.status).toBeUndefined();
    expect(recovered?.detail).toBeUndefined();
  });

  it("clears the stale status/detail pill when a failing test recovers (internal plan review, finding 7)", () => {
    const events = parseSessionJsonl([
      tool("first", "Bash", { command: "npm test" }), errorResult("first", "FAIL something"),
      tool("retry", "Bash", { command: "npm test" }), result("retry"),
    ].join("\n")).events;
    const recovered = deriveActivityFeed(events, context("pass")).cards.filter((c) => c.kind === "test").at(-1);
    // No invented "recovered" sentence any more (iterate-2026-09-05-mission-
    // feed-ux-gaps) — the recorded gate's own fallback text fills in since
    // this transcript's turns wrote no narration of their own.
    expect(recovered?.text).toBe("Tests have a recorded passing result.");
    expect(recovered?.status).toBe("ok");
    expect(recovered?.detail).toBeUndefined();
  });

  it("does not misattribute one command's error excerpt to a coalesced multi-command card (internal plan review, finding 8)", () => {
    const events = parseSessionJsonl([
      tool("a", "Read", { file_path: "a.ts" }),
      tool("b", "Read", { file_path: "b.ts" }),
      errorResult("a", "Some read error"),
    ].join("\n")).events;
    const blocker = deriveActivityFeed(events, context("unknown")).cards.find((card) => card.kind === "blocker");
    expect(blocker?.commands).toEqual(["Read: a.ts", "Read: b.ts"]);
    expect(blocker?.status).toBe("err");
    expect(blocker?.detail).toBeUndefined();
  });

  it("never shares a test card between two distinct failing test commands (external review catch, verified non-issue)", () => {
    // Unlike blocker/implement/etc., every `test`-bucket tool_use pushes its
    // own fresh card rather than going through add()'s coalescing — so the
    // single-command misattribution guard blocker cards need does not apply
    // here. This probe confirms it, rather than taking that on faith.
    const events = parseSessionJsonl([
      tool("a", "Bash", { command: "npm test suiteA" }), errorResult("a", "FAIL suiteA"),
      tool("b", "Bash", { command: "npm test suiteB" }), errorResult("b", "FAIL suiteB"),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("unknown")).cards.filter((c) => c.kind === "test");
    expect(cards).toHaveLength(2);
    expect(cards[0].detail).toBe("FAIL suiteA");
    expect(cards[1].detail).toBe("FAIL suiteB");
  });

  it("attaches a single command's error excerpt when the card represents exactly one command", () => {
    const events = parseSessionJsonl([tool("a", "Read", { file_path: "a.ts" }), errorResult("a", "ENOENT: a.ts not found")].join("\n")).events;
    const blocker = deriveActivityFeed(events, context("unknown")).cards.find((card) => card.kind === "blocker");
    expect(blocker?.detail).toBe("ENOENT: a.ts not found");
  });

  it("shows the real merged PR title on the delivery card when the commit artifact carries one", () => {
    const withCommitDetail = {
      ...context("pass", false),
      artifacts: context("pass", false).artifacts.map((item) => item.kind === "commit"
        ? { ...item, detail: { type: "commit" as const, commit: "abc123", message: "fix(mission): real content", prNumber: 367, prUrl: "https://x/367", merge: "merged" as const } }
        : item),
    };
    const feed = deriveActivityFeed([], withCommitDetail);
    expect(feed.cards.find((card) => card.kind === "delivery")?.text).toBe('Merged as "fix(mission): real content".');
  });

  it("keeps the generic delivery sentence when no commit message is available", () => {
    const feed = deriveActivityFeed([], context("pass", false));
    expect(feed.cards.find((card) => card.kind === "delivery")?.text).toBe("This completed run is recorded through durable artifacts.");
  });

  it("matches a plain-text resolution against a listed option (real CLI shape, askuser-roundtrip.jsonl)", () => {
    const events = parseSessionJsonl([
      tool("ask", "AskUserQuestion", { questions: [{ question: "Which platform?", header: "Platform", options: [{ label: "Web App" }, { label: "Mobile App" }], multiSelect: false }] }),
      okResult("ask", "Web App"),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.resolved).toBe(true);
    expect(card?.question?.picked).toBe("Web App");
  });

  it("keeps a resolved-but-unmatched answer as free text, not a picked option (external review catch)", () => {
    const events = parseSessionJsonl([
      tool("ask", "AskUserQuestion", { questions: [{ question: "Which platform?", options: [{ label: "Web App" }, { label: "Mobile App" }] }] }),
      okResult("ask", "Both, actually"),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.resolved).toBe(true);
    expect(card?.question?.picked).toBeUndefined();
    expect(card?.question?.answer).toBe("Both, actually");
  });

  it("keeps a question pending when its tool_result is an error, not a real answer (code review catch, mini-plan)", () => {
    const events = parseSessionJsonl([
      tool("ask", "AskUserQuestion", { questions: [{ question: "Which platform?", options: [{ label: "Web App" }] }] }),
      errorResult("ask", "cancelled"),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.resolved).toBe(false);
  });

  it("keeps an unresolved question's CTA-gating field false until a tool_result resolves it", () => {
    const events = parseSessionJsonl(tool("ask", "AskUserQuestion", { questions: [{ question: "Which platform?", options: [{ label: "Web App" }] }] })).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "user-input");
    expect(card?.question?.resolved).toBe(false);
  });

  it("marks a spec/review artifact card status ok so the pill has a MissionContext-derived source", () => {
    const reviewContext = {
      ...context("unknown"),
      artifacts: [...context("unknown").artifacts, { kind: "review" as const, label: "Review", state: "available" as const, summary: null, receipt: null, detail: null }],
    };
    const events = parseSessionJsonl(tool("review", "Task", { description: "Review the change" })).events;
    expect(deriveActivityFeed(events, reviewContext).cards.find((card) => card.kind === "review")?.status).toBe("ok");
  });
});

describe("explanationExcerpt (iterate-2026-08-25-mission-feed-progress-narration)", () => {
  it("returns empty for empty or whitespace-only input", () => {
    expect(explanationExcerpt("")).toBe("");
    expect(explanationExcerpt("   \n  \n\t")).toBe("");
  });

  it("returns short input unchanged, under both caps", () => {
    expect(explanationExcerpt("first line\nsecond line")).toBe("first line\nsecond line");
  });

  it("preserves internal blank lines as paragraph breaks", () => {
    expect(explanationExcerpt("para one\n\npara two")).toBe("para one\n\npara two");
  });

  it("truncates past the line cap with a trailing ellipsis on the last kept line", () => {
    const out = explanationExcerpt(["a", "b", "c", "d", "e", "f", "g"].join("\n"), 3);
    expect(out).toBe("a\nb\nc…");
  });

  it("truncates past the char cap on code points, never splitting a surrogate pair", () => {
    const emoji = "🎉"; // U+1F389, a surrogate pair in UTF-16 (2 code units, 1 code point)
    const out = explanationExcerpt(emoji.repeat(5), 6, 3);
    expect(out).toBe(`${emoji.repeat(3)}…`);
    expect(out.includes("�")).toBe(false);
  });

  it("strips control and bidi-override characters while preserving newlines/tabs", () => {
    const dirty = `line\tone${String.fromCodePoint(0x202e)}\nline${String.fromCodePoint(0x07)}two`;
    expect(explanationExcerpt(dirty)).toBe("line\tone\nlinetwo");
  });

  it("strips ANSI escape sequences", () => {
    const esc = String.fromCodePoint(0x1b);
    expect(explanationExcerpt(`${esc}[31mred${esc}[0m text`)).toBe("red text");
  });

  it("strips C1 control characters, matching card.text's sanitization (AC-3b, spec-reviewer catch)", () => {
    const dirty = `line${String.fromCodePoint(0x81)}one\nline${String.fromCodePoint(0x9c)}two`;
    expect(explanationExcerpt(dirty)).toBe("lineone\nlinetwo");
  });
});
