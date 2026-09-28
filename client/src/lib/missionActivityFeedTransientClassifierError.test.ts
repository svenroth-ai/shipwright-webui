/*
 * missionActivityFeedTransientClassifierError.test.ts — AC3 + AC4
 * (iterate-2026-09-28-mission-feed-completeness).
 *
 * The harness's own "auto mode classifier gave no verdict (error)" tool-call
 * rejection is a preflight failure, not a real command result — the tool
 * never ran. Before this fix it was treated exactly like a genuine failure:
 * a non-test tool call permanently became a "command failed" `blocker` card
 * (reported: "Ich habe immer noch failed drin. Die sollen weg."), and a test
 * invocation rejected this way left a wordless "1 command" chip with no pill
 * once a LATER real invocation became the feed's own reconciled verdict
 * (reported: "einzeiler drin mit Commands. Ohne Text. Die sollen auch weg.").
 * Split into its own file rather than appended to the already-sizeable
 * `missionActivityFeed.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import { isTransientClassifierError } from "./missionActivityFeedTransientError";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: string, isError: boolean) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [] });

// Verbatim text measured against a real captured transcript.
const TRANSIENT_TEXT = "The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash. This is a transient failure of the check, not a judgment about the action: a later response may get a verdict. You may try the action again once, as-is.";

describe("isTransientClassifierError", () => {
  it("matches the harness's real rejection text", () => {
    expect(isTransientClassifierError(TRANSIENT_TEXT)).toBe(true);
  });

  it("does not match a real failure that merely quotes the phrase mid-message, not as the whole content", () => {
    const realFailure = `Command failed with exit code 1.\nNote: this is unrelated to "${TRANSIENT_TEXT}" mentioned in a log excerpt.`;
    expect(isTransientClassifierError(realFailure)).toBe(false);
  });

  it("does not match an ordinary command failure", () => {
    expect(isTransientClassifierError("npm ERR! Test failed. See above for more details.")).toBe(false);
  });

  // External code review catch (openai, blocking): `startsWith` on the
  // prefix alone would classify ANY content beginning with that exact
  // sentence as transient, regardless of what follows — including a genuine
  // failure whose own output happens to open with it for unrelated reasons.
  it("does not match a genuine failure that shares only the fixed prefix, not the fixed suffix after the tool name", () => {
    const sharesOnlyThePrefix = "The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash: some genuinely different, unrelated failure occurred here.";
    expect(isTransientClassifierError(sharesOnlyThePrefix)).toBe(false);
  });

  // Second, independent external-review catch (F11 local PR-review
  // preflight): the fix above still matched ANY content trailing the
  // template's "...about the action: " lead-in with no end anchor — a
  // genuine error whose output starts with the full known template and then
  // continues with real failure detail would still be discarded as
  // transient. Same known template verbatim, plus unrelated content where
  // the real message would already have ended.
  it("does not match the exact known template followed by unrelated failure output appended after it", () => {
    const templateThenRealFailure = `${TRANSIENT_TEXT} Also: connection reset by peer while retrying.`;
    expect(isTransientClassifierError(templateThenRealFailure)).toBe(false);
  });
});

describe("deriveActivityFeed — AC3: a non-test tool call rejected by the transient classifier", () => {
  it("never becomes a blocker card", () => {
    const events = parseSessionJsonl([tool("t1", "Bash", { command: "git commit -m 'x'" }), result("t1", TRANSIENT_TEXT, true)].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.some((card) => card.kind === "blocker")).toBe(false);
  });

  it("a genuine command failure still becomes a blocker card (negative control)", () => {
    const events = parseSessionJsonl([tool("t1", "Bash", { command: "git commit -m 'x'" }), result("t1", "fatal: nothing to commit", true)].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown"));
    expect(feed.cards.some((card) => card.kind === "blocker")).toBe(true);
  });
});

describe("deriveActivityFeed — AC3 + AC4: a test invocation rejected by the transient classifier, then genuinely retried", () => {
  it("drops the rejected attempt's card entirely, leaving only the real retry's verdict", () => {
    const events = parseSessionJsonl([
      tool("t1", "Bash", { command: "npm test" }),
      result("t1", TRANSIENT_TEXT, true),
      tool("t2", "Bash", { command: "npm test" }),
      result("t2", "12 passed", false),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].text).toBe("Tests have a recorded passing result.");
    expect(testCards[0].status).toBe("ok");
  });

  it("a genuinely failing test invocation still keeps its card (negative control)", () => {
    const events = parseSessionJsonl([tool("t1", "Bash", { command: "npm test" }), result("t1", "1 failed, 0 passed", true)].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].status).toBe("err");
  });
});

// code-review catch (high): dropping a transient-rejected AUTHORING run's
// card must not leave it reachable via `authoringConsumedBy` — otherwise a
// later out-of-order rollback of its backing Write can resurrect the
// detached card and misread it as a "successful recovery", clearing an
// unrelated, still-open genuine test failure's red status. Mirrors
// `missionActivityFeedAuthoringRollback.test.ts`'s own "run-first" ordering
// probe for the same mechanism, substituting a transient rejection for a
// genuine success.
describe("deriveActivityFeed — AC3+AC4: a transient-rejected authoring run must not resurrect a false recovery via authoringConsumedBy", () => {
  it.each([
    ["write-first", ["w1", "authoring"]],
    ["run-first", ["authoring", "w1"]],
  ] as const)("an unrelated earlier genuine failure stays red (%s result order)", (_name, order) => {
    const events = parseSessionJsonl([
      tool("verify", "Bash", { command: "npm test" }),
      result("verify", "1 failed, 0 passed", true),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "authoring", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: order.map((id) =>
        id === "w1"
          ? { type: "tool_result", tool_use_id: id, content: "output", is_error: true }
          : { type: "tool_result", tool_use_id: id, content: TRANSIENT_TEXT, is_error: true }) } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    // The transient authoring-run card is dropped entirely, and — the bug —
    // the earlier `npm test` failure must NOT have been merged into it.
    expect(testCards).toHaveLength(1);
    expect(testCards[0].commands).toEqual(["Bash: npm test"]);
    expect(testCards[0].status).toBe("err");
  });

  // doubt-review catch (high): `authoringConsumedBy` is not the only path
  // into `unstampAuthoringRun` — `restoreValidationPending` is a SECOND,
  // deferred one, populated when a same-turn SECOND write to the same path
  // fails while its own EARLIER write's fate is still unknown. A card can
  // still be a value there even after its `authoringConsumedBy` entry was
  // already purged by the drop below.
  it("an unrelated earlier genuine failure stays red when the deferred restoreValidationPending path is the one still holding the dropped card (W1-error, then T1 transient reject, then W0-error)", () => {
    const events = parseSessionJsonl([
      tool("verify", "Bash", { command: "npm test" }),
      result("verify", "1 failed, 0 passed", true),
      // w0 and w1 both target the SAME path — w1 replaces w0's tracker entry
      // and records `writtenTestFileRestore` pointing back at w0, per
      // missionActivityFeedAuthoringRollback.ts's own same-turn-second-write
      // shape. "authoring" then consumes w1's entry.
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w0", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "authoring", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        // w1 fails first: authoringConsumedBy still holds w0 -> nothing (w0's
        // own entry was already replaced), so rollback defers via
        // restoreValidationPending.set(w0, card) instead of un-stamping now.
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        // T1's own result is the transient rejection — dropTransientTestCard
        // purges the (by-now-repointed) authoringConsumedBy entry, but the
        // card is STILL a value in restoreValidationPending keyed by w0.
        { type: "tool_result", tool_use_id: "authoring", content: TRANSIENT_TEXT, is_error: true },
        // w0 fails last: rollbackFailedWrite reads restoreValidationPending,
        // finds the already-dropped card, and would misread it as a
        // successful recovery without the restoreValidationPending purge.
        { type: "tool_result", tool_use_id: "w0", content: "output", is_error: true },
      ] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].commands).toEqual(["Bash: npm test"]);
    expect(testCards[0].status).toBe("err");
  });
});

// External code review catch (openai, medium): the transient/non-test
// `continue` used to run BEFORE the `writtenTestFile` rollback, so a
// transiently-rejected Write of a test file — bucket "implement", since a
// Write is never bucket "test" — left its optimistic `writtenTestFiles`
// tracker entry in place even though the write never actually landed.
describe("deriveActivityFeed — a transiently-rejected Write of a test file rolls back its tracker entry", () => {
  it("a later genuine test run for the same path is not misclassified as continuing that authoring run", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }),
      result("w1", TRANSIENT_TEXT, true),
      tool("t1", "Bash", { command: "vitest run src/lib/foo.test.ts" }),
      result("t1", "1 passed", false),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
  });
});

// External code review catch (glm, low): the same non-test `continue` also
// intercepted a transiently-rejected Agent/Task dispatch before it ever
// reached `applySubrunnerAck`'s existing isError->"failed" fail-closed path,
// leaving the subrunner card stuck "Running…" forever with no way to
// resolve — the same stuck/unclickable symptom class AC6 fixes for a
// different trigger.
describe("deriveActivityFeed — a transiently-rejected subrunner dispatch resolves instead of sticking on Running", () => {
  it("an Agent dispatch rejected by the transient classifier resolves to failed, not stuck running", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "a1", name: "Agent", input: { subagent_type: "general-purpose", description: "Investigate the failure" } }] } });
    const events = parseSessionJsonl([dispatch, result("a1", TRANSIENT_TEXT, true)].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    const subrunnerCards = feed.cards.filter((card) => card.kind === "subrunner");
    expect(subrunnerCards).toHaveLength(1);
    expect(subrunnerCards[0].subrunnerStatus).toBe("failed");
  });

  // The actual root cause was one level deeper than the trigger that
  // surfaced it: the generic `else if (result.is_error)` blocker branch in
  // `resolveToolResults` matched ANY error for any not-yet-excluded bucket,
  // so it also swallowed a GENUINE (non-transient) dispatch failure before
  // `applySubrunnerAck`'s own `isError`->"failed" fail-closed path — already
  // covered by direct unit tests in `missionActivityFeedSubrunner.test.ts` —
  // was ever reached. This proves that path is now actually reachable from
  // the real reducer, for every kind of dispatch error, not only a
  // transiently-rejected one.
  it("a genuinely failed (non-transient) Agent dispatch still resolves to a failed subrunner card, never a blocker card (negative control)", () => {
    const dispatch = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "a1", name: "Agent", input: { subagent_type: "general-purpose", description: "Investigate the failure" } }] } });
    const events = parseSessionJsonl([dispatch, result("a1", "The agent launch failed outright.", true)].join("\n")).events;
    const feed = deriveActivityFeed(events, null);
    expect(feed.cards.some((card) => card.kind === "blocker")).toBe(false);
    const subrunnerCards = feed.cards.filter((card) => card.kind === "subrunner");
    expect(subrunnerCards).toHaveLength(1);
    expect(subrunnerCards[0].subrunnerStatus).toBe("failed");
    expect(subrunnerCards[0].subrunnerReport).toBe("The agent launch failed outright.");
  });
});
