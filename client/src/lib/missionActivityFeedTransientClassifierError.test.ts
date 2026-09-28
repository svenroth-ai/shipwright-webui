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
