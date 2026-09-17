/*
 * iterate-2026-09-16-mission-feed-render-fidelity — split out of
 * `missionActivityFeedBlockerAndTdd.test.ts` (23rd round, 300-line
 * convention) to cover the FAILED-write rollback mechanism itself:
 * tracker-entry restoration, same-turn tool_result ordering, multi-write
 * interactions. Rollback-free authoring cases stay in the sibling file.
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

describe("deriveActivityFeed — failed-write rollback mechanism", () => {
  // 11th-round catch (openai, medium; confirmed rounds 7 and 11): a FAILED
  // Write left its entry in place, excluding a later genuine run of that path.
  it("does not exclude a targeted run from the gate stamp when the 'just-written' tool call actually failed", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1", true),
      tool("verify", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 14th-round catch (both reviewers, medium/low): a failed EDIT to an
  // already-written file rolled back by PATH, killing the Write's tracking.
  it("does not lose a successful write's own tracking to a LATER failed edit of the same file", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("e1", "Edit", { file_path: "src/lib/foo.test.ts" }), result("e1", true),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBe(true);
  });

  // 28th-round catch (openai, medium): a failed Edit no longer touches the
  // tracker (27th-round fix), but rollback still RESTORED the earlier Write's
  // entry — duplicating it, so a SECOND run consumed the duplicate.
  it("does not duplicate the tracker entry when a failed Edit follows an already-successful Write, so a second targeted run stays genuine verification", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      tool("e1", "Edit", { file_path: "src/lib/foo.test.ts" }), result("e1", true),
      tool("run1", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run1"),
      tool("run2", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run2"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[1].authoringRun).toBeUndefined();
  });

  // 20th-round catch (openai, medium): rollback-by-PATH deleted a same-turn
  // SECOND write's valid entry when the FIRST write's error came back.
  it("does not lose a same-turn SECOND write's entry when an earlier same-turn write to the same path failed", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w2", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "w2", content: "output", is_error: false },
      ] } }),
      tool("authoring", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("authoring"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBe(true);
  });

  // 16th-round catch (openai, medium): a SINGLE turn issuing `Write` then
  // `Bash vitest run <that file>` stamps the Bash card as authoring BEFORE
  // the Write's result is known — a FAILED Write must roll that stamp back.
  it("un-stamps a same-turn Bash run's authoringRun when its own Write actually failed", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "run", content: "output", is_error: false },
      ] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 17th-round catch (openai, medium): the rollback un-stamped the consumed
  // card unconditionally, but an EARLIER successful Write to the same path
  // (restored by it) is real authoring provenance too.
  it("keeps a same-turn Bash run's authoringRun when its own Edit failed but an earlier Write to the same file already succeeded", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), result("w1"),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "e1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "run", content: "output", is_error: false },
      ] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    // Still an authoring run, so reconcile synthesizes the separate
    // run-wide summary card too.
    expect(testCards).toHaveLength(2);
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    expect(testCards[1].authoringRun).toBeUndefined();
    expect(testCards[1].status).toBe("ok");
  });

  // 18th-round catch (openai, medium): tool_result order within one user
  // event isn't guaranteed to match tool_use order. If the Bash run's own
  // result lands BEFORE its Write's, its `is_error` branch leaves `status`
  // unset (still `authoringRun` then) — the later Write-failure rollback
  // must retroactively set `status: "err"` AND open the recovery slot
  // (24th-round catch, openai: status-only left a genuine success stranded).
  it("surfaces a genuine failing status when a same-turn Bash run's result is processed BEFORE its own Write's failed result, and lets a later genuine success recover it", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "run", content: "failure output", is_error: true },
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
      ] } }),
      tool("verify", "Bash", { command: "npm test" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    // The later genuine "npm test" success merges INTO this card as a
    // recovery — ONE card survives, not two.
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 27th-round catch (openai, medium): same ordering as above, but the Bash
  // run's own failing output is EMPTY, so `card.detail` is falsy — a
  // truthiness check alone could not tell "failed with nothing to show"
  // apart from "never failed", leaving the un-stamp a no-op.
  it("surfaces a genuine failing status when the same-turn Bash run's own failing output is empty, and lets a later genuine success recover it", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "run", content: "", is_error: true },
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
      ] } }),
      tool("verify", "Bash", { command: "npm test" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 23rd-round catch (openai, medium): `writtenTestFileRestore` only proves
  // an earlier same-path write was TRACKED, never that it SUCCEEDED — if
  // BOTH same-turn writes to one path failed, the run stayed wrongly
  // stamped. Covers both orderings (the fix's check differs by which lands).
  it("un-stamps authoringRun when BOTH same-turn writes to the same path failed (second write's failure processed first)", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w2", name: "Edit", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "w2", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "run", content: "output", is_error: false },
      ] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBeUndefined();
  });

  it("un-stamps authoringRun when BOTH same-turn writes to the same path failed (first write's failure processed first)", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w2", name: "Edit", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "run", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "w2", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "run", content: "output", is_error: false },
      ] } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBeUndefined();
  });

  // 25th-round catch (openai, medium): the no-consumedCard fallback branch
  // restored the earlier write's entry unconditionally, missing the
  // failedWriteToolIds check — a later separate-turn run then inherited it.
  it("does not restore an earlier write's entry for a LATER run when BOTH same-turn writes failed and nothing consumed the entry in that turn", () => {
    const events = parseSessionJsonl([
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "w2", name: "Edit", input: { file_path: "src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
        { type: "tool_result", tool_use_id: "w2", content: "output", is_error: true },
      ] } }),
      tool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), result("run"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // 26th-round catch (glm, medium): a retroactive un-stamp unconditionally
  // overwrote `state.unresolvedTest`, even when it pointed at an UNRELATED
  // still-open failure from an earlier turn — whose retry then had no card.
  it("does not clobber a different, still-open genuine failure's recovery slot when an unrelated authoring run is retroactively un-stamped", () => {
    const events = parseSessionJsonl([
      tool("a-run", "Bash", { command: "vitest run src/lib/a.test.ts" }), result("a-run", true),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/b.test.ts" } },
        { type: "tool_use", id: "b-run", name: "Bash", input: { command: "vitest run src/lib/b.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "b-run", content: "failure output", is_error: true },
        { type: "tool_result", tool_use_id: "w1", content: "output", is_error: true },
      ] } }),
      tool("verify", "Bash", { command: "npm test" }), result("verify"),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    // cardA (the genuine a.test.ts failure) must absorb the later "npm test"
    // recovery, not the retroactively un-stamped cardB. Asserted via
    // `commands`, not the pill: reconcile re-stamps only the LAST test
    // card's pill from the gate, so a status assertion would pass even on
    // the clobbered merge.
    expect(testCards).toHaveLength(2);
    expect(testCards[0].commands.some((c) => c.includes("npm test"))).toBe(true);
    expect(testCards[1].commands).toEqual(["Bash: vitest run src/lib/b.test.ts"]);
  });

  // A same-turn write FAILS while its targeted run SUCCEEDED, so the run is
  // retroactively un-stamped — in BOTH tool_result orderings the now-genuine
  // success must recover the earlier `npm test` failure into ONE card, not
  // strand it red. Write-first was already correct (36th-round, openai);
  // run-first was NOT (38th-round, openai): that card's own success branch
  // skipped the merge while still stamped `authoringRun` (12th-round rule).
  // The 36th round DECLINED it as order-impossible, contradicting the 18th.
  it.each([
    ["write-first", ["w1", "authoring"]],
    ["run-first", ["authoring", "w1"]],
  ] as const)("recovers an earlier genuine failure when the un-stamped run succeeded (%s result order)", (_name, order) => {
    const events = parseSessionJsonl([
      tool("verify", "Bash", { command: "npm test" }), result("verify", true),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/lib/foo.test.ts" } },
        { type: "tool_use", id: "authoring", name: "Bash", input: { command: "vitest run src/lib/foo.test.ts" } },
      ] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: order.map((id) =>
        ({ type: "tool_result", tool_use_id: id, content: "output", is_error: id === "w1" })) } }),
    ].join("\n")).events;
    const feed = deriveActivityFeed(events, context("pass"));
    const testCards = feed.cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
    expect(testCards[0].commands).toEqual(["Bash: npm test", "Bash: vitest run src/lib/foo.test.ts"]);
  });
});
