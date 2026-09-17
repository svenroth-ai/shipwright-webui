/*
 * iterate-2026-09-16-mission-feed-render-fidelity - the SYNTHESIZED gate
 * summary card, split out of `missionActivityFeedBlockerAndTdd.test.ts` at
 * the project's 300-line convention (57th review round). One cohesive group:
 * what `reconcileArtifactCards` pushes when no GENUINE verification card
 * exists, across recorded pass / fail / unknown and across live vs terminal. */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] } });

const context = (gate: "pass" | "fail" | "unknown", live = true): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: live, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
] });

describe("reconcileArtifactCards - the synthesized run-wide gate summary card", () => {
  // External review catch (both reviewers) + 8th-round amendment (glm,
  // medium): the reconcile fallback used to stamp an authoring-only run with
  // the gate when no genuine verification card existed — the single most
  // common real case (a run ending right after its one TDD cycle). Fix:
  // synthesize a SEPARATE run-wide summary card instead, never stamping the
  // authoring card itself, so the recorded gate stays visible.
  it("does not stamp the authoring card's own pill, but still surfaces the recorded gate as a separate card, when the ONLY test activity is a TDD authoring run", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
    expect(testCards[1].text).toBe("Tests have a recorded passing result.");
  });

  it("surfaces a recorded FAILING gate as its own card even when the only test activity is a failing TDD authoring run", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring", true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("err");
    expect(testCards[1].text).toBe("Tests have a recorded failing result.");
  });

  // 9th-round external code review catch (glm, low): pins the UNKNOWN-gate
  // case explicitly — a genuinely unresolved recorded gate still gets its own
  // separate summary card rather than silently disappearing once the authoring
  // card stopped absorbing it. AMENDED by the 55th-round catch (glm, medium):
  // that requirement is about a run that has FINISHED, and this fixture only
  // used the helper's default `live = true` incidentally. It now says terminal
  // explicitly; the live arm is the separate case below.
  it("surfaces an UNKNOWN recorded gate as its own card when the only test activity is a TDD authoring run", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown", false));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("warn");
    expect(testCards[1].text).toBe("No reliable test result is recorded.");
  });

  // 55th-round catch (glm, medium), FIXED: while the run is still LIVE and the
  // gate has recorded nothing, the synthesis branch used to push "No reliable
  // test result is recorded." (warn) mid-run - a verdict-shaped sentence about
  // a run that has not finished. A RECORDED pass/fail still synthesizes while
  // live; that is the 8th-round guarantee, pinned by the arms above.
  it("does not synthesize a 'no reliable result' card mid-run when the gate has recorded nothing yet", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, context("unknown", true)).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBe(true);
  });

  // 57th-round catch (glm, low, regression): the 55th-round live guard skips
  // the synthesis for EVERY live run with no genuine verification card, not
  // only the authoring-only case it was aimed at - including a live run that
  // has run no tests at all. That IS intended (mid-run, nothing recorded yet,
  // so there is no verdict to surface and nothing to hide), and glm asked for
  // it to be a RECORDED decision rather than a side effect. This is that pin;
  // the cost - the `tests` artifact chip is feed-absent until the run settles
  // - is documented at the guard itself.
  it("synthesizes nothing mid-run when the gate has recorded nothing and there is no test activity at all", () => {
    const events = parseSessionJsonl([
      tool("e1", "Edit", { file_path: "src/lib/foo.ts" }), result("e1"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("unknown", true));
    expect(feed.cards.filter((card) => card.kind === "test")).toHaveLength(0);
  });

  it("still synthesizes it once that same run is TERMINAL", () => {
    const events = parseSessionJsonl([
      tool("e1", "Edit", { file_path: "src/lib/foo.ts" }), result("e1"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, context("unknown", false)).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].text).toBe("No reliable test result is recorded.");
    expect(testCards[0].artifact).toBe("tests");
  });

  // 65th-round catch (glm, low), FIXED - reverses the 61st round's acceptance
  // with the argument it lacked: `null` is ALSO the transient initial-load
  // state, and requirement 1 made this card the only gate signal, so the warn
  // verdict would flash before the context arrives. Falsify by restoring the
  // guard's `!context?.runLive` spelling - the card comes back.
  it("synthesizes nothing at all while the MissionContext has not loaded yet", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run"),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, null).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards.some((card) => card.text === "No reliable test result is recorded.")).toBe(false);
  });
});
