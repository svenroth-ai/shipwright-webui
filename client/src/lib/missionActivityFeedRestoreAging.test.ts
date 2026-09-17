/*
 * iterate-2026-09-16-mission-feed-render-fidelity — the 65th-round catch
 * (openai, medium): a failed REPLACEMENT write restores the earlier write's
 * tracker snapshot, and that snapshot has to re-enter the carry window at its
 * REAL age. Its own test file (the rollback suite is at the 300-line
 * convention) because it needs the multi-tool-per-event shapes below: a
 * tool_result is processed only after EVERY tool_use of its assistant event,
 * so under-aging is only observable when calls are BATCHED after the write. */
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../external/session-parser";
import { deriveActivityFeed } from "./missionActivityFeed";
import type { MissionContext } from "./missionContextApi";

const line = (value: unknown) => JSON.stringify(value);
const tools = (...calls: readonly { id: string; name: string; input: Record<string, unknown> }[]) =>
  line({ type: "assistant", message: { role: "assistant", content: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })) } });
const tool = (id: string, name: string, input: Record<string, unknown>) => tools({ id, name, input });
const results = (...entries: readonly (readonly [string, boolean])[]) =>
  line({ type: "user", message: { role: "user", content: entries.map(([id, isError]) => ({ type: "tool_result", tool_use_id: id, content: "output", is_error: isError })) } });

const context = (): MissionContext => ({ schemaVersion: 1, scenario: "iterate", missionTabVisible: true, runId: "iterate-x", runLive: true, servesFrId: null, sourceRev: "x", tests: { passed: 12, total: 12, skipped: 0, gate: "pass" }, artifacts: [
  { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
] });

const batched = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: "Read", input: { file_path: `src/other/${i}.ts` } }));
const batchedResults = (count: number) => Array.from({ length: count }, (_, i) => [`r${i}`, false] as const);

describe("deriveActivityFeed — a restored write snapshot re-enters the carry window at its real age", () => {
  // Falsify by dropping `agedRestore`'s elapsed top-up (or its cap check) in
  // `missionActivityFeedAuthoringRollback.ts`: the snapshot then comes back at
  // its capture-time staleness and the final run is wrongly exempted.
  it("drops the restored snapshot when calls batched after the failed replacement write have aged it past the cap", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), results(["w1", false]),
      tools({ id: "w2", name: "Write", input: { file_path: "src/lib/foo.test.ts" } }, ...batched(6)),
      results(["w2", true], ...batchedResults(6)),
      tool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), results(["run", false]),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, context()).cards.filter((card) => card.kind === "test");
    expect(testCards).toHaveLength(1);
    expect(testCards[0].authoringRun).toBeUndefined();
    expect(testCards[0].status).toBe("ok");
  });

  // The other side: with only ONE batched call the window has NOT elapsed, so
  // the earlier write's provenance still earns the exemption. This is what
  // keeps the top-up from degenerating into "never restore".
  it("still restores the snapshot when the elapsed calls leave it inside the window", () => {
    const events = parseSessionJsonl([
      tool("w1", "Write", { file_path: "src/lib/foo.test.ts" }), results(["w1", false]),
      tools({ id: "w2", name: "Write", input: { file_path: "src/lib/foo.test.ts" } }, ...batched(1)),
      results(["w2", true], ...batchedResults(1)),
      tool("run", "Bash", { command: "vitest run src/lib/foo.test.ts" }), results(["run", false]),
    ].join("\n")).events;
    const testCards = deriveActivityFeed(events, context()).cards.filter((card) => card.kind === "test");
    expect(testCards[0].authoringRun).toBe(true);
    expect(testCards[0].status).toBeUndefined();
    // With the only real run exempt, the recorded gate moves to the separate
    // synthesized summary card — the arrangement requirement 5 asks for.
    expect(testCards[1].text).toBe("Tests have a recorded passing result.");
  });
});
