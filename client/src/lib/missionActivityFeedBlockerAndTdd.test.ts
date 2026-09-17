/*
 * iterate-2026-09-16-mission-feed-render-fidelity — split out of
 * `missionActivityFeed.test.ts` (already near the project's 300-line
 * convention) to cover excluding a TDD authoring run (a freshly-written
 * test's own first run) from the run-wide pass/fail gate stamp. The blocker-
 * explanation coverage this file also used to hold moved to the sibling
 * `missionActivityFeedBlockerText.test.ts` (17th-round, re-crossed 300); the
 * FAILED-write rollback MECHANISM (tracker restoration, tool_result
 * ordering) moved to `missionActivityFeedAuthoringRollback.test.ts` (23rd-
 * round, re-crossed 300 again).
 */
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

describe("deriveActivityFeed — TDD authoring runs are excluded from the gate stamp", () => {
  it("excludes a TDD authoring run (the freshly-written test's own first run) from the run-wide gate stamp (reported: authoring runs got the same Passing/Failing pill as a genuine verification)", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
      tool("verify", "Bash", { command: "npm test" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
  });

  // 32nd-round external review catch (glm, medium, verified unreachable): a
  // SECOND, IDENTICAL targeted run of the just-written file never coalesces
  // into the first (already-`authoringRun`) card — the "test" bucket never
  // goes through the coalescing `add()` helper at all (every test tool_use
  // gets its own fresh `ActivityCard`), and the tracker entry the first run
  // consumed is already removed by the time the second run looks it up, so
  // the second run's own `matchIndex` lookup finds nothing and it lands as
  // ordinary, un-stamped verification exactly as a genuine re-run should.
  it("treats a second, identical targeted run of the just-written file as genuine re-verification, not a coalesced authoring card", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
      tool("edit", "Edit", { file_path: "src/lib/foo.ts" }), result("edit"),
      tool("verify", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
  });

  it("does not give a FAILING TDD authoring run the same 'Failing' pill/accent as a genuine verification failure (spec-reviewer catch: the canonical TDD red step was left unguarded — resolveToolResults' is_error branch set status='err' unconditionally, ignoring authoringRun)", () => {
    // Two DISTINCT failures (never a success in between, so the recovery-
    // merge never fires and collapses them) — the authoring run's own failed
    // attempt, then an unrelated genuine verification failure.
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring", true),
      tool("verify", "Bash", { command: "npm test" }), result("verify", true),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    // The failed authoring run's own local result must not set "err" — that
    // is what `pillLabel()`/`kindAccent()` key off to render "Failing"/red.
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    // The raw failure output is still attached — only the pill is gated.
    expect(testCards[0].detail).toBeTruthy();
    // The genuine failure is unaffected — it still shows as Failing.
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("err");
  });

  // 12th-round catch (openai, medium): the reverse of the 3rd-round catch
  // below — a genuine verification FAILURE opens the recovery slot, then a
  // SUCCESSFUL authoring run must not be read as recovery evidence for it.
  it("does not let a successful TDD authoring run recover an earlier, unrelated genuine verification failure", () => {
    const events = parseSessionJsonl([
      tool("verify", "Bash", { command: "npm test" }), result("verify", true),
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("fail"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    // The earlier genuine failure is untouched — still its own card, still
    // carrying the recorded failing gate, never silently "recovered".
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("err");
    // The authoring run stays its own, separate, unstamped card.
    expect(testCards[1].authoringRun).toBe(true);
    expect(testCards[1].status).toBeUndefined();
  });

  // 3rd-round catch (openai, medium): a FAILING authoring run used to still
  // open a "recovery slot" (`unresolvedTest`), so a later genuine success
  // was silently merged into it and inherited `authoringRun: true`.
  it("does not swallow a later genuine 'npm test' pass into a failed TDD authoring run's card", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring", true),
      tool("verify", "Bash", { command: "npm test" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
  });

  // External code review catch (glm): the prior strict `===` comparison
  // never matched in practice since Claude's own `file_path` is frequently
  // absolute while the shell command names a relative path.
  it("recognizes an authoring run even when the written file's path is absolute and the run command's own path is relative", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "/project/src/lib/foo.test.ts" }), result("w1"),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBe(true);
  });

  // 27th-round external code review catch (openai, medium): the spec limits
  // the exemption to "the freshly-written test file's OWN first run" — an
  // Edit to a PRE-EXISTING test file (never written by Claude this session)
  // is ordinary verification, not authoring, even on its first run after.
  it("does not treat an Edit to a pre-existing test file (no matching prior Write) as an authoring run", () => {
    const events = parseSessionJsonl([
      tool("e1", "Edit", { file_path: "src/lib/foo.test.ts" }), result("e1"),
      tool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 39th-round catch (glm, low), DECLINED as a KNOWN LIMITATION — pinned so a
  // future change here is deliberate. A turn listing the Bash run BEFORE its
  // own Write has no tracker entry yet when the run's card is built, so the
  // run stays genuine verification (the SAFE outcome) and the Write's entry
  // survives for the next run of that path. Full rationale in
  // `missionActivityFeedAuthoringRollback.ts`'s module doc.
  it("leaves a run listed BEFORE its own same-turn Write as genuine verification, and lets the next run consume the entry", () => {
    const events = parseSessionJsonl([
      event({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
      ] } }),
      event({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "run", content: "output", is_error: false },
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: false },
      ] } }),
      tool("run2", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run2"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[1].authoringRun).toBe(true);
  });

  // 41st-round catch (openai, medium, spec), DECLINED — pinned here. openai
  // reads the JS/TS+Python-only `TEST_FILE_PATH` as leaving a written-then-run
  // Go/Rust/Ruby/Java test wrongly gate-stamped. Nothing stamps it: those
  // runners are not test invocations at all, so the card never enters the test
  // bucket the gate stamp writes to. See `missionActivityFeedAuthoringTrack.ts`.
  it("gives a Go test file written and immediately run NO gate stamp, because `go test` is not a recognized test invocation", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "pkg/foo_test.go" }), result("w1"),
      tool("b1", "Bash", { command: "go test ./pkg/foo_test.go" }), result("b1"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const goCard = feed.cards.find((card) => card.commands.some((label) => label.includes("go test")));
    // 44th-round catch (glm, low, test), FIXED: without this the optional-
    // chained assertions below would pass vacuously if the lookup ever missed.
    expect(goCard).toBeDefined();
    expect(goCard?.kind).toBe("implement");
    expect(goCard?.status).toBeUndefined();
    expect(goCard?.authoringRun).toBeUndefined();
    // The only `test` card is the SYNTHESIZED gate sentence from the context's
    // `tests` artifact — no transcript card was ever bucketed as a test run.
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].commands).toHaveLength(0);
  });

  // 42nd-round catch (openai, medium, spec), FIXED: `__tests__/` is Jest's
  // other default `testMatch` half and needs no `.test.` infix, so this run
  // WAS a recognized test invocation whose freshly-written target went
  // unrecognized. Falsify by dropping `TESTS_DIR_PATH` from `isTestFilePath`.
  it("exempts a freshly-written `__tests__/` file's own first run (Jest's other default testMatch)", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/__tests__/login.ts" }), result("w1"),
      tool("b1", "Bash", { command: "jest src/__tests__/login.ts" }), result("b1"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const run = feed.cards.find((card) => card.commands.some((label) => label.includes("jest")));
    expect(run?.kind).toBe("test");
    expect(run?.authoringRun).toBe(true);
    expect(run?.status).toBeUndefined();
  });

  // 42nd-round catch (openai, medium, spec), FIXED: a coalesced card whose
  // ONE failing tool_use turns it into a blocker used to get no `detail` at
  // all, so requirement 4's disclosure showed the chips and no raw output.
  // Falsify by restoring `if (commands.length === 1) attachDetail(...)`.
  it("keeps a coalesced blocker's raw output, attributed to the command that actually failed", () => {
    const events = parseSessionJsonl([
      event({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/x/a.ts" } },
        { type: "tool_use", id: "r2", name: "Read", input: { file_path: "/x/b.ts" } },
      ] } }),
      event({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "r1", content: "fine", is_error: false },
        { type: "tool_result", tool_use_id: "r2", content: "ENOENT: no such file", is_error: true },
      ] } }),
    ].join("\n")).events;
    const blocker = deriveActivityFeed(events, null).cards.find((card) => card.kind === "blocker");
    expect(blocker?.commands).toHaveLength(2);
    expect(blocker?.detail).toContain("ENOENT: no such file");
    expect(blocker?.detail?.startsWith("Read: /x/b.ts")).toBe(true);
  });

});
