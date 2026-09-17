/*
 * `ActivityCard.commandCount` - the TRUE tool-call count, kept separate from
 * the deduplicated `commands` labels. Split out of
 * `missionActivityFeedFields.test.ts` at the project's 300-line convention
 * (61st review round); both arms of the contract live here together. */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const event = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => event({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, isError = false) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] } });
const errorResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] } });
const okResult = (id: string, content: string) => event({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });

const context = (gate: "pass" | "fail" | "unknown"): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true, servesFrId: null, sourceRev: "x", tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate }, artifacts: [
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
] });

describe("deriveActivityFeed - commandCount tracks real tool calls, not deduped labels", () => {
  // 24th-round catch (openai, medium): two DISTINCT tool calls sharing one
  // deduplicated label under-counted as "1 command" — `commandCount` tracks
  // the real call count separately from `commands.length`.
  it("counts two identical-label tool calls as commandCount 2, even though they dedupe to one command chip", () => {
    const events = parseSessionJsonl([
      tool("r1", "Read", { file_path: "src/foo.ts" }), result("r1"),
      tool("r2", "Read", { file_path: "src/foo.ts" }), result("r2"),
    ].join("\n")).events;
    const card = deriveActivityFeed(events, context("unknown")).cards.find((c) => c.kind === "investigate");
    expect(card?.commands).toHaveLength(1);
    expect(card?.commandCount).toBe(2);
  });

  // 61st-round catch (glm, low): the `commandCount` contract was documented at
  // the type but nothing FAILED on a violation. This is the reducer-level
  // guard glm asked for - every card, every bucket, all-distinct labels, count
  // === labels. Falsified against the documented violation shape (a creation
  // site pre-populating `commands` while `attachCommand` seeds from 0).
  // 67th-round catch (openai, medium), DECLINED as a MISREAD, and THIS test is
  // the disposition. openai reports the test-card creation site builds
  // `commands: [label]`, so `attachCommand`'s `commandCount ?? commands.length`
  // seeding would make every test card say "2 commands" — and predicts this
  // very loop fails on its own test-card fixture. It does not: the literal in
  // `missionActivityFeed.ts` is `commands: []`, the label arrives only via
  // `attachCommand` (the sole writer of both fields, per the INVARIANT block in
  // `missionActivityFeedTypes.ts`), the `npm test` card below IS a test card,
  // and the loop is GREEN. The predicted failure is exactly the mutation this
  // test was falsified against in round 61, so the guard openai asks for ships.
  it("keeps commandCount equal to the label count on every card the reducer builds, across buckets", () => {
    const events = parseSessionJsonl([
      tool("a", "Edit", { file_path: "src/a.ts" }), result("a"),
      tool("b", "Read", { file_path: "src/b.ts" }), result("b"),
      tool("t", "Bash", { command: "npm test" }), result("t"),
      tool("r", "Bash", { command: "uv run review.py" }), okResult("r", "PASS"),
      tool("x", "Bash", { command: "python build.py" }), errorResult("x", "boom"),
    ].join("\n")).events;
    const cards = deriveActivityFeed(events, context("pass")).cards.filter((card) => card.commands.length > 0);
    expect(cards.length).toBeGreaterThan(2);
    for (const card of cards) expect(card.commandCount).toBe(card.commands.length);
  });
});
