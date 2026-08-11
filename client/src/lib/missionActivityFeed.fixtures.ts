import { parseSessionJsonl } from "../external/session-parser";
import type { MissionContext } from "./missionContextApi";

const record = (value: unknown) => JSON.stringify(value);
const tool = (id: string, name: string, input: Record<string, unknown>) => record({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const result = (id: string, isError = false) => record({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "output", is_error: isError }] },
});

export function fixtureContext(gate: "pass" | "fail" | "unknown", runLive = true): MissionContext {
  return {
    schemaVersion: 1,
    scenario: "iterate",
    missionTabVisible: true,
    runId: "iterate-fixture",
    runLive,
    servesFrId: null,
    sourceRev: "fixture",
    tests: { passed: gate === "pass" ? 12 : null, total: gate === "pass" ? 12 : null, skipped: 0, gate },
    artifacts: [
      { kind: "spec", label: "Spec", state: "available", summary: null, receipt: null, detail: null },
      { kind: "requirement", label: "Requirement", state: "available", summary: null, receipt: null, detail: null },
      { kind: "tests", label: "Tests", state: "available", summary: null, receipt: null, detail: null },
      { kind: "commit", label: "Delivery", state: "available", summary: null, receipt: null, detail: null },
    ],
  };
}

export const shortSecurityFixture = parseSessionJsonl([
  tool("scan", "Bash", { command: "npm test security" }),
  result("scan", true),
].join("\n")).events;

export const releaseFixture: MissionContext = {
  ...fixtureContext("unknown", false),
  scenario: "pipeline",
  tests: null,
  artifacts: [
    { kind: "spec", label: "Release specification", state: "available", summary: null, receipt: null, detail: null },
    { kind: "phase", label: "Release", state: "available", summary: null, receipt: null, detail: {
      type: "phase", runId: "run-release", phase: "release", splitId: null, status: "done",
      slashCommand: "/shipwright-deploy", title: "Release", description: "Ship the release", startedAt: null,
      completedAt: "2026-08-11T12:00:00Z", executionCount: 1, errors: [], outputs: [],
    } },
  ],
};

export const longIterateFixture = parseSessionJsonl(Array.from({ length: 905 }, (_, index) => tool(
  `read-${index}`,
  "Read",
  { file_path: `/repo/source-${index}.ts` },
)).flatMap((entry, index) => index === 450
  ? [record({ type: "system", subtype: "compact_boundary", content: "Context automatically compacted" }), entry]
  : [entry]).join("\n")).events;
