/*
 * stage-derivation.test.ts — the honest "Where it stands" derivation, part 1:
 * the edit-path authority + the ITERATE lifecycle rules
 * (FR-01.66, campaign 2026-07-18-mission-artifacts S4, AC1-AC3).
 *
 * Every assertion here was verified to FAIL against the pre-S4 derivation
 * (revert-and-rerun, the campaign's standing rule after three rounds in which a
 * test asserted the bug back to itself). Where a test passes both before and
 * after — the AC3 windowing guard — that is stated explicitly rather than left
 * to look like new coverage.
 *
 * The scenario-gating half (AC4/AC5) lives in
 * `stage-derivation.scenarios.test.ts` — split to hold the 300-LOC ceiling.
 */

import { describe, it, expect } from "vitest";

import { classifyEditPath, deriveStage } from "./stage-derivation";
import { currentIterateEvents, summarizeTranscript } from "./narrator-transcript";
import { parseSessionJsonl } from "../external/session-parser";

function jsonl(...events: Record<string, unknown>[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
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
const prLink = (n: number) => ({
  type: "pr-link",
  prNumber: n,
  prUrl: `https://x/${n}`,
  prRepository: "o/r",
});

const parse = (...e: Record<string, unknown>[]) => parseSessionJsonl(jsonl(...e)).events;

describe("classifyEditPath — one authority for what an edit touched", () => {
  it("separates product work from scope bookkeeping", () => {
    expect(classifyEditPath("/repo/src/thing.ts")).toBe("product");
    expect(classifyEditPath("/repo/client/src/lib/x.tsx")).toBe("product");
    expect(classifyEditPath("/repo/.shipwright/planning/iterate/x/spec.md")).toBe("spec");
    expect(classifyEditPath("/repo/CHANGELOG.md")).toBe("finalize");
    // The measured real-world offenders (S4 probe over 114 iterate transcripts).
    expect(classifyEditPath("/tmp/claude/xyz/scratchpad/probe.mjs")).toBe("incidental");
    expect(classifyEditPath("C:/Users/x/.claude/projects/p/memory/note.md")).toBe("incidental");
    expect(classifyEditPath("/repo/.shipwright/agent_docs/architecture.md")).toBe("incidental");
    expect(classifyEditPath("/repo/plan.json")).toBe("incidental");
    expect(classifyEditPath("/repo/todo.md")).toBe("incidental");
  });

  it("keeps the pre-existing anchoring — 'spec' as a substring is NOT the Spec stage", () => {
    expect(classifyEditPath("/repo/src/specification.ts")).toBe("product");
    expect(classifyEditPath("/repo/src/login.spec.ts")).toBe("product");
    expect(classifyEditPath("/repo/src/inspect.ts")).toBe("product");
  });

  it("normalises Windows separators (io-boundary probe)", () => {
    expect(classifyEditPath("C:\\repo\\.shipwright\\planning\\spec.md")).toBe("spec");
    expect(classifyEditPath("C:\\repo\\scratchpad\\probe.py")).toBe("incidental");
  });

  // External plan review, Gemini finding 2 / GPT finding 6: a LOOSE substring
  // match on "plan" / "todo" / "scratch" would misclassify ordinary application
  // files as incidental and silently suppress a real Build. The anchors are
  // filename- and segment-exact; these lock that in.
  it("does NOT swallow application files whose names merely contain plan/todo/scratch", () => {
    for (const p of [
      "/repo/src/features/subscription-plan.ts",
      "/repo/src/components/todo-list.tsx",
      "/repo/src/lib/planner.ts",
      "/repo/src/scratchpad-view.tsx",
      "/repo/src/memory-cache.ts",
      "/repo/src/utils/plan.json.ts",
      "/repo/src/logger.ts",
    ]) {
      expect(classifyEditPath(p)).toBe("product");
    }
  });

  it("an empty / missing path is product, not silently incidental", () => {
    // A malformed tool_use with no file_path must not be treated as scope work —
    // that would be an unreadable value folding into a benign one.
    expect(classifyEditPath("")).toBe("product");
  });
});

describe("evidence is STRUCTURAL — prose cannot spoof a stage", () => {
  // External plan review, GPT findings 5 + 11: markers are read from `tool_use`
  // blocks only. A message that merely MENTIONS a command must not move the
  // stepper — transcript prose is untrusted third-party input.
  it("a user or assistant message naming commands evidences nothing", () => {
    const prose = parse(
      { type: "user", message: { content: "run npm run build then git push and gh pr create" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "I will npm run test and git commit next." }] },
      },
    );
    expect(deriveStage(prose, { scenario: "iterate" }).stage).toBeNull();
    expect(deriveStage(prose, { scenario: "plain" }).activity).toBeNull();
  });

  it("only a real tool_use moves it", () => {
    const real = parse(toolUse("Bash", { command: "npm run test" }));
    expect(deriveStage(real, { scenario: "iterate" }).stage).toBe("Test");
  });
});

describe("AC1 — Analyze holds through scope + calibration", () => {
  // THE REGRESSION. Pre-S4 this returned "Build": the scratchpad write set the
  // build flag and Build outranks Analyze. Measured incidence over 114 real
  // iterate transcripts: 17 (15%) opened exactly this way.
  it("a stray scratchpad write during scope does NOT jump the stage to Build", () => {
    const events = parse(
      slashCommand("shipwright-iterate"),
      toolUse("Bash", { command: 'uv run ".../classify_complexity.py" --message x' }),
      toolUse("Read", { file_path: "/repo/src/thing.ts" }),
      toolUse("Grep", { pattern: "inferStage" }),
      toolUse("TodoWrite", {}),
      toolUse("Write", { file_path: "/tmp/claude/abc/scratchpad/probe.mjs" }),
    );
    expect(deriveStage(events, { scenario: "iterate" }).stage).toBe("Analyze");
  });

  it("a memory note and a plan.json during scope are also scope, not Build", () => {
    for (const p of ["/home/u/.claude/projects/p/memory/n.md", "/repo/plan.json"]) {
      const events = parse(slashCommand("shipwright-iterate"), toolUse("Write", { file_path: p }));
      expect(deriveStage(events, { scenario: "iterate" }).stage).toBe("Analyze");
    }
  });

  it("but a PRODUCT edit still advances — Analyze is not sticky against real work", () => {
    const events = parse(
      slashCommand("shipwright-iterate"),
      toolUse("Write", { file_path: "/repo/scratchpad/probe.mjs" }),
      toolUse("Edit", { file_path: "/repo/src/thing.ts" }),
    );
    expect(deriveStage(events, { scenario: "iterate" }).stage).toBe("Build");
  });

  it("the iterate's own scope tooling evidences Analyze on its own", () => {
    const events = parse(
      toolUse("Bash", { command: 'uv run ".../setup_iterate_worktree.py" --slug x' }),
    );
    expect(deriveStage(events, { scenario: "iterate" }).stage).toBe("Analyze");
  });
});

describe("AC2 — the stepper advances on REAL transitions only", () => {
  const stageOf = (scenario: "iterate", ...e: Record<string, unknown>[]) =>
    deriveStage(parse(...e), { scenario }).stage;

  it("Spec only once the iterate spec is actually written", () => {
    expect(
      stageOf(
        "iterate",
        slashCommand("shipwright-iterate"),
        toolUse("Write", { file_path: "/repo/.shipwright/planning/iterate/r/spec.md" }),
      ),
    ).toBe("Spec");
  });

  it("then Build / Test / Finalize / Merge on their real transitions", () => {
    const kick = slashCommand("shipwright-iterate");
    const spec = toolUse("Write", { file_path: "/repo/.shipwright/planning/iterate/r/spec.md" });
    expect(stageOf("iterate", kick, spec, toolUse("Edit", { file_path: "/repo/src/a.ts" }))).toBe(
      "Build",
    );
    expect(stageOf("iterate", kick, spec, toolUse("Bash", { command: "npm run test" }))).toBe(
      "Test",
    );
    expect(
      stageOf("iterate", kick, spec, toolUse("Bash", { command: 'git commit -m "feat: x"' })),
    ).toBe("Finalize");
    expect(stageOf("iterate", kick, spec, prLink(9))).toBe("Merge");
  });

  // External code review, GPT finding 1 (HIGH). Running a command NAMED
  // "…-plan" / "…-spec" writes nothing, so it is not Spec evidence. AC2 says
  // Spec means the iterate spec was actually written.
  it("a slash command whose NAME contains spec/plan does NOT reach Spec", () => {
    expect(deriveStage(parse(slashCommand("shipwright-plan")), { scenario: "iterate" }).stage).toBe(
      null,
    );
    expect(
      deriveStage(parse(slashCommand("shipwright-iterate"), slashCommand("some-spec-command")), {
        scenario: "iterate",
      }).stage,
    ).toBe("Analyze");
  });

  // External code review, GPT finding 7 (MEDIUM). The brief named TodoWrite the
  // PRIMARY phase signal; the S4 probe measured it at 10/114 real iterate
  // transcripts (9%) carrying free-form campaign unit lists, not the phase
  // vocabulary. Deriving a stage by keyword-matching that text would fabricate a
  // phase. This pins the DECISION rather than leaving the absence untested: a
  // realistic payload naming later phases must not move the stepper.
  it("a realistic TodoWrite payload is Analyze evidence only — its text never sets a stage", () => {
    const todos = toolUse("TodoWrite", {
      todos: [
        { content: "A18 files-terminal-three-card — RISKIEST: terminal stays byte-identical", status: "completed" },
        { content: "Run the build, then the test suite, then finalize and open the PR", status: "in_progress" },
        { content: "Finalization F0-F12", status: "pending" },
      ],
    });
    const d = deriveStage(parse(slashCommand("shipwright-iterate"), todos), { scenario: "iterate" });
    expect(d.stage).toBe("Analyze");
    expect(d.basis).toBe("iterate_phase_markers");
  });

  it("an unparseable / empty transcript is an honest '—', NEVER a default Analyze", () => {
    // The campaign's recurring shape: "could not read" collapsing into a benign
    // value. Analyze is a claim about a real phase, not a fallback.
    expect(deriveStage([], { scenario: "iterate" }).stage).toBeNull();
    expect(summarizeTranscript("", { scenario: "iterate" }).stage).toBeNull();
    expect(summarizeTranscript("{not json", { scenario: "iterate" }).stage).toBeNull();
    // An assistant turn with no tool use evidences no phase at all.
    const prose = parse({ type: "assistant", message: { content: [{ type: "text", text: "hm" }] } });
    expect(deriveStage(prose, { scenario: "iterate" }).stage).toBeNull();
  });
});

describe("AC3 — currentIterateEvents windowing preserved", () => {
  // NOTE: this guards behaviour that already existed. It passes before AND after
  // S4 by design — it is here to prove the fix did not eat the windowing, not to
  // claim new coverage.
  const twoSubIterates = jsonl(
    slashCommand("shipwright-iterate"),
    toolUse("Edit", { file_path: "/repo/src/one.ts" }),
    toolUse("Bash", { command: "npm run test" }),
    toolUse("Bash", { command: 'git commit -m "feat: one"' }),
    prLink(1),
    slashCommand("shipwright-iterate"),
    toolUse("Edit", { file_path: "/repo/src/two.ts" }),
  );

  it("reads the CURRENT sub-iterate's stage, not the previous one's Merge", () => {
    const { events } = parseSessionJsonl(twoSubIterates);
    expect(deriveStage(events, { scenario: "campaign" }).stage).toBe("Merge"); // un-windowed
    expect(deriveStage(currentIterateEvents(events), { scenario: "campaign" }).stage).toBe("Build");
    expect(summarizeTranscript(twoSubIterates, { scenario: "campaign" }).stage).toBe("Build");
  });

  it("a campaign whose current sub-iterate is still scouting reads Analyze, not the prior Merge", () => {
    // Both halves of the fix at once: the window excludes sub-iterate #1's PR,
    // AND #2's scratch write does not fake a Build.
    const content = jsonl(
      slashCommand("shipwright-iterate"),
      toolUse("Edit", { file_path: "/repo/src/one.ts" }),
      prLink(1),
      slashCommand("shipwright-iterate"),
      toolUse("Write", { file_path: "/repo/scratchpad/notes.md" }),
    );
    expect(summarizeTranscript(content, { scenario: "campaign" }).stage).toBe("Analyze");
  });
});
