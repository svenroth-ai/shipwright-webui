/*
 * stage-derivation.scenarios.test.ts — the honest "Where it stands" derivation,
 * part 2: SCENARIO GATING (FR-01.66, campaign 2026-07-18-mission-artifacts S4,
 * AC4-AC5).
 *
 * The six-stage Analyze->Merge lifecycle is an ITERATE concept. These pin that
 * it never runs on a card without one, that a pipeline task uses its
 * authoritative run-config phase, and that a plain session gets a coarse
 * activity read rather than a fabricated lifecycle position.
 *
 * Part 1 (the edit-path authority + the iterate rules) is in
 * `stage-derivation.test.ts` — split to hold the 300-LOC ceiling.
 */
import { describe, it, expect } from "vitest";

import { deriveStage } from "./stage-derivation";
import { parseSessionJsonl } from "../external/session-parser";

function jsonl(...events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join(String.fromCharCode(10));
}
const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] },
});
const slashCommand = (name: string) => ({
  type: "user",
  message: {
    content: `<command-message>${name}</command-message><command-name>/${name}</command-name>`,
  },
});

const parse = (...e: Record<string, unknown>[]) => parseSessionJsonl(jsonl(...e)).events;

describe("AC4 — scenario-gated: the iterate rule never runs on a non-iterate card", () => {
  // A genuinely NON-iterate fixture: no `/shipwright-iterate` kickoff anywhere,
  // just a scratch write. Under the iterate branch this would STICK to Analyze;
  // on a non-iterate card the sticky rule must be OFF entirely.
  const nonIterate = parse(
    toolUse("Read", { file_path: "/repo/README.md" }),
    toolUse("Write", { file_path: "/repo/scratchpad/probe.mjs" }),
  );
  // The same shape WITH the kickoff, for the contrast assertions.
  const iterate = parse(
    slashCommand("shipwright-iterate"),
    toolUse("Write", { file_path: "/repo/scratchpad/probe.mjs" }),
  );

  it("the sticky-Analyze rule does NOT run on a non-iterate card", () => {
    // The discriminator: identical scratch write, opposite treatment.
    expect(deriveStage(iterate, { scenario: "iterate" }).stage).toBe("Analyze");
    expect(deriveStage(nonIterate, { scenario: "plain" }).stage).toBeNull();
    expect(deriveStage(nonIterate, { scenario: "plain" }).basis).toBe("coarse_activity");
  });

  it("a pipeline task takes its run-config phase — not a tool-signal guess", () => {
    // Note the fixture: even WITH a kickoff marker present, `pipeline` ignores
    // the transcript entirely and reports the authoritative phase.
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "build" }).stage).toBe("Build");
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "build" }).basis).toBe(
      "pipeline_phase",
    );
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "design" }).stage).toBe("Analyze");
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "plan" }).stage).toBe("Spec");
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "deploy" }).stage).toBe("Merge");
    // Case-insensitive, since the phase crosses a wire.
    expect(deriveStage(iterate, { scenario: "pipeline", phase: "TEST" }).stage).toBe("Test");
  });

  it("an UNREADABLE pipeline phase is an honest '—', not a fallback to the guess", () => {
    // The S3 finding's shape: an unreadable value must not fold into a benign
    // one. A missing phase must NOT silently fall back to the tool heuristic
    // (which would have said Analyze here and looked perfectly plausible).
    for (const phase of [null, undefined, "", "not-a-phase"]) {
      const d = deriveStage(iterate, { scenario: "pipeline", phase });
      expect(d.stage).toBeNull();
      expect(d.basis).toBe("coarse_activity");
    }
  });

  it("a campaign DOES carry the lifecycle — its window is its active sub-iterate", () => {
    expect(deriveStage(iterate, { scenario: "campaign" }).stage).toBe("Analyze");
  });

  it("a `plain` card whose transcript SHOWS a kickoff still gets the lifecycle", () => {
    // `plain` means the resolver found no RECORD — not that no iterate ran. A
    // campaign whose record has not landed, or an iterate whose pointer was
    // pruned, both resolve `plain` with the kickoff plainly in the transcript.
    // Withholding the stage there would be a fabrication in the other direction.
    expect(deriveStage(iterate, { scenario: "plain" }).stage).toBe("Analyze");
    expect(
      deriveStage(parse(slashCommand("shipwright-iterate"), toolUse("Bash", { command: "npm test" })), {
        scenario: "plain",
      }).stage,
    ).toBe("Test");
  });
});

describe("AC5 — a plain / pure session gets a coarse read, never a fabricated stage", () => {
  it("claims NO lifecycle position, and states what it is doing in plain words", () => {
    const editing = parse(toolUse("Edit", { file_path: "/repo/src/thing.ts" }));
    const d = deriveStage(editing, { scenario: "plain" });
    // Pre-S4 this said "Build" — a formal lifecycle claim for a session that is
    // not running that lifecycle at all.
    expect(d.stage).toBeNull();
    expect(d.activity).toBe("Editing files");
    expect(d.basis).toBe("coarse_activity");
  });

  it("reads the coarse activity off the same strong markers", () => {
    const of = (...e: Record<string, unknown>[]) =>
      deriveStage(parse(...e), { scenario: "plain" }).activity;
    expect(of(toolUse("Bash", { command: "npm run test" }))).toBe("Running tests");
    expect(of(toolUse("Bash", { command: "npm run build" }))).toBe("Building the project");
    expect(of(toolUse("Bash", { command: "git push origin HEAD" }))).toBe(
      "Pushing and opening the pull request",
    );
    expect(of(toolUse("Read", { file_path: "/a.ts" }))).toBe("Reading the code");
  });

  it("the sticky-Analyze rule is OFF — a plain session never claims Analyze", () => {
    const scouting = parse(toolUse("Read", { file_path: "/a.ts" }), toolUse("TodoWrite", {}));
    expect(deriveStage(scouting, { scenario: "plain" }).stage).toBeNull();
  });

  it("an empty plain session evidences nothing — no stage AND no activity", () => {
    expect(deriveStage([], { scenario: "plain" })).toEqual({
      stage: null,
      activity: null,
      basis: "none",
    });
  });
});

describe("back-compat — an unresolved scenario still behaves", () => {
  it("reads iterate-ness off the transcript's own kickoff when the resolver is silent", () => {
    const events = parse(
      slashCommand("shipwright-iterate"),
      toolUse("Write", { file_path: "/repo/scratchpad/probe.mjs" }),
    );
    // No scenario supplied (context still loading / older server): the kickoff
    // marker is real evidence, so the fix holds rather than flickering Build.
    expect(deriveStage(events).stage).toBe("Analyze");
  });

  it("a non-iterate transcript with no scenario keeps the pre-S4 stage reading", () => {
    expect(deriveStage(parse(toolUse("Edit", { file_path: "/repo/src/a.ts" }))).stage).toBe("Build");
    expect(deriveStage(parse(toolUse("Bash", { command: "npm test" }))).stage).toBe("Test");
  });

  it("UNRESOLVED is not the same claim as `plain` — only the latter suppresses", () => {
    // The distinction is load-bearing. `null` = the resolver has not answered;
    // `plain` = it answered "no lifecycle here". Collapsing the first into the
    // second would strip the stage off every card while the query is merely in
    // flight, and would treat missing information as a positive finding.
    const editing = parse(toolUse("Edit", { file_path: "/repo/src/a.ts" }));
    expect(deriveStage(editing, { scenario: null }).stage).toBe("Build");
    expect(deriveStage(editing, { scenario: "plain" }).stage).toBeNull();
  });

  it("is deterministic — identical input yields identical output", () => {
    const events = parse(slashCommand("shipwright-iterate"), toolUse("Read", { file_path: "/a" }));
    expect(deriveStage(events, { scenario: "iterate" })).toEqual(
      deriveStage(events, { scenario: "iterate" }),
    );
  });
});
