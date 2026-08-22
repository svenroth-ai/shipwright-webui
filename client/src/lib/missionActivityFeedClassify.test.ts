/*
 * iterate-2026-08-22-mission-feed-fixes — regression coverage for the two
 * over-matching bucket-classification bugs (§1: `test`/`review` regexes
 * matching an arbitrary substring anywhere in a shell command; §2: every
 * `Task` spawn unconditionally bucketed as `review`) plus the reducer-level
 * effect of each fix.
 */
import { describe, expect, it } from "vitest";
import { isReviewInvocation, isReviewTask, isTestInvocation } from "./missionActivityFeedClassify";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });

const context = (): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true, servesFrId: null, sourceRev: "x", tests: null, artifacts: [] });

describe("isTestInvocation", () => {
  it("does not match a file path that merely contains the substring 'test'", () => {
    expect(isTestInvocation('git checkout -- shipwright_test_results.json')).toBe(false);
  });

  it("matches a real vitest/playwright/pytest/jest invocation", () => {
    expect(isTestInvocation("vitest run")).toBe(true);
    expect(isTestInvocation("npx playwright test")).toBe(true);
    expect(isTestInvocation("uv run pytest -x")).toBe(true);
    expect(isTestInvocation("npx jest --watch")).toBe(true);
  });

  it("matches npm test / npm t / npm run test* forms", () => {
    expect(isTestInvocation("npm test")).toBe(true);
    expect(isTestInvocation("npm t")).toBe(true);
    expect(isTestInvocation("npm run test:e2e")).toBe(true);
  });

  it("does not match npm run for an unrelated script", () => {
    expect(isTestInvocation("npm run build")).toBe(false);
  });

  // Internal code review (low): a naive leading-assignment strip that isn't
  // quote-aware truncates mid-value on a quoted env var containing a space,
  // corrupting the rest of the token split.
  it("still finds the invocation past a leading env var whose quoted value contains a space", () => {
    expect(isTestInvocation('SOME_VAR="a b" vitest run')).toBe(true);
    expect(isTestInvocation("SOME_VAR='a b' npx playwright test")).toBe(true);
  });

  it("still matches a real test invocation inside a quoted commit-message chain", () => {
    expect(isTestInvocation('git commit -m "fix: handle && in body" && vitest run')).toBe(true);
  });

  it("does not misread a chain separator that appears inside a quoted argument", () => {
    // The literal `&&` lives inside the commit message string, not between
    // two chained commands — a naive split on `&&` would produce a bogus
    // second segment ` in body\"` that must not be tested independently.
    expect(isTestInvocation('git commit -m "fix: handle && in body"')).toBe(false);
  });

  // External code review (two independent reviewers, medium/low) — a
  // backslash-escaped quote inside a double-quoted argument must not close
  // the tracked quote state early and misread a following real chain.
  it("does not let an escaped quote inside a double-quoted argument close the quote state early", () => {
    expect(isTestInvocation('git commit -m "She said \\"it\'s ok\\"" && vitest run')).toBe(true);
  });

  it("does not treat an escaped-quote message alone as containing a real chained test invocation", () => {
    expect(isTestInvocation('git commit -m "She said \\"it\'s ok\\""')).toBe(false);
  });
});

describe("isReviewInvocation", () => {
  it("does not match a path that merely contains the substring 'review'", () => {
    expect(isReviewInvocation("git add reviews.json")).toBe(false);
    expect(isReviewInvocation("cat self-review.json")).toBe(false);
  });

  it("matches this project's own review CLIs as the invoked binary", () => {
    expect(isReviewInvocation("uv run record_review_pass.py show --run-id x")).toBe(true);
    expect(isReviewInvocation("external_review.py --mode iterate")).toBe(true);
  });

  // External code review (medium) — a bare `python`/`python3` prefix (no
  // `-m`) resolves to the script name, not just `python -m <script>`.
  it("matches a review script invoked via a bare python/python3 prefix", () => {
    expect(isReviewInvocation("python record_review_pass.py show --run-id x")).toBe(true);
    expect(isReviewInvocation("python3 external_review.py --mode iterate")).toBe(true);
  });
});

describe("isReviewTask", () => {
  it("buckets a Task as review when subagent_type says so", () => {
    expect(isReviewTask("Task", { subagent_type: "code-reviewer" })).toBe(true);
  });

  it("buckets a Task as review when only the description says so", () => {
    expect(isReviewTask("Task", { subagent_type: "general-purpose", description: "Review the diff for correctness" })).toBe(true);
  });

  it("does not false-positive on 'preview' (word-boundary match)", () => {
    expect(isReviewTask("Task", { subagent_type: "general-purpose", description: "Check the preview panel renders" })).toBe(false);
  });

  it("falls back to false for a non-review subagent spawn", () => {
    expect(isReviewTask("Task", { subagent_type: "general-purpose", description: "Investigate the auth bug" })).toBe(false);
  });

  it("only applies to the Task tool", () => {
    expect(isReviewTask("Bash", { description: "review the output" })).toBe(false);
  });
});

describe("deriveActivityFeed bucket classification (reducer-level)", () => {
  it("does not misclassify a checkout of a test-results file as a test card", () => {
    const events = parseSessionJsonl(tool("a", "Bash", { command: "git checkout -- shipwright_test_results.json" })).events;
    const feed = deriveActivityFeed(events, context());
    expect(feed.cards.some((card) => card.kind === "test")).toBe(false);
  });

  it("does not misclassify a general-purpose Task spawn as review", () => {
    const events = parseSessionJsonl(tool("a", "Task", { subagent_type: "general-purpose", description: "Investigate the auth bug" })).events;
    const feed = deriveActivityFeed(events, context());
    expect(feed.cards.find((c) => c.commands.length)?.kind).toBe("implement");
  });

  it("still classifies a code-reviewer Task spawn as review", () => {
    const events = parseSessionJsonl(tool("a", "Task", { subagent_type: "code-reviewer", description: "Review the diff" })).events;
    const feed = deriveActivityFeed(events, context());
    expect(feed.cards.some((card) => card.kind === "review")).toBe(true);
  });
});
