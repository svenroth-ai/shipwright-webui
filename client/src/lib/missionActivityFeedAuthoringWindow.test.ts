/*
 * iterate-2026-09-16-mission-feed-render-fidelity - the REDUCER-level arms of
 * the TDD authoring-run carry window, split out of
 * `missionActivityFeedAuthoringTrack.test.ts` at the project's 300-line
 * convention (55th review round). That file keeps the unit-level tests over
 * `missionActivityFeedAuthoringTrack.ts`'s own exports; these two drive the
 * whole `deriveActivityFeed` reducer, one on each side of the window. */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";
// 53rd-round catch (openai, medium), DECLINED on the knob but ANSWERED with
// the reducer-level test it asked for. openai repeats (7th time: rounds 39,
// 43, 47, 49, 50, 52, 53) that `MAX_AUTHORING_TRACK_CARRY = 6` is broader
// than "immediately after", and adds one NEW sub-claim: the tracker "does not
// age at all across narration-only turns". That is true and INTENTIONAL -
// `trackWrittenTestFile` runs once per TOOL CALL (missionActivityFeed.ts:269),
// and prose between a write and its run is not work that makes the write
// stale. The knob itself stays: clearing on "unrelated" tool categories would
// break the ordinary `Read`-between-write-and-run shape (see the decline at
// the constant). What was genuinely missing is a REDUCER-level proof that the
// cap actually bounds the exemption end to end - the existing cap test is
// unit-level on `trackWrittenTestFile`. This is that proof.
const trackEvent = (value: unknown) => JSON.stringify(value);
const trackTool = (id: string, name: string, input: Record<string, unknown>) => trackEvent({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const trackResult = (id: string) => trackEvent({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: false }] } });
const trackContext = (): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true, servesFrId: null, sourceRev: "x", tests: { passed: 12, total: 12, skipped: 0, gate: "pass" }, artifacts: [
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed - the authoring-run carry window is bounded", () => {
  // 55th-round catch (openai, low, test): openai asks for the within-window
  // case too, expecting the run to get the genuine gate stamp. That is the
  // knob itself, DECLINED seven rounds running - so this pins the contract as
  // it actually ships: inside the window the run IS the authoring run, which
  // is precisely what "a `Read` between writing and running" has to keep
  // working. The boundary case below pins the other side. 63rd round (openai,
  // medium) asked for THIS test to be rewritten to the rejected proposal -
  // declined at the constant; it is the pin, not a stale assertion. The 69th
  // asks again and adds the reasoning out loud ("the tests lock in behavior
  // that conflicts with the spec"). Same answer: the knob is the disputed
  // decision, and a test rewritten to match a proposal that was never adopted
  // would assert something the code does not do.
  it("still treats a targeted run as the authoring run when ONE unrelated tool call separates it from its Write", () => {
    const events = parseSessionJsonl([
      trackTool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), trackResult("w1"),
      trackTool("r1", "Read", { file_path: "src/lib/foo.ts" }), trackResult("r1"),
      trackTool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), trackResult("run"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, trackContext()).cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
  });

  // 62nd-round catch (openai, medium), DECLINED on the knob but its "consume
  // the tracked file" half ANSWERED here — and this is what falsifies the
  // finding's stated harm. The exemption is ONE-SHOT per Write: the matched
  // entry is deleted at consumption (`missionActivityFeed.ts:213`), so a
  // SECOND run of the same file, still well inside the window, is ordinary
  // verification and keeps the gate stamp. Falsify by dropping that filter
  // line — the second card then also comes back `authoringRun: true`.
  it("exempts only the FIRST run of a just-written test file — a second run inside the window gets the genuine gate stamp", () => {
    const events = parseSessionJsonl([
      trackTool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), trackResult("w1"),
      trackTool("run1", "Bash", { command: "vitest run src/lib/foo.test.ts" }), trackResult("run1"),
      trackTool("run2", "Bash", { command: "vitest run src/lib/foo.test.ts" }), trackResult("run2"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, trackContext()).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
  });

  it("gives a targeted run the genuine gate stamp once more than MAX_AUTHORING_TRACK_CARRY unrelated tool calls separate it from its Write", () => {
    const unrelated = ["a", "b", "c", "d", "e", "f", "g"].flatMap((id) => [trackTool(id, "Read", { file_path: `src/other/${id}.ts` }), trackResult(id)]);
    const events = parseSessionJsonl([
      trackTool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), trackResult("w1"),
      ...unrelated,
      trackTool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), trackResult("run"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, trackContext()).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });
});
