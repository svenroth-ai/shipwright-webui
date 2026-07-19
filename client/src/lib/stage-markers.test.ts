/*
 * stage-markers.test.ts — the evidence layer behind the "Where it stands"
 * derivation (FR-01.66, campaign 2026-07-18-mission-artifacts S4).
 *
 * One question runs through every test here: does this marker EVIDENCE the
 * phase it claims, or merely mention its name? Three separate bugs in this
 * iterate were that same confusion — a command NAMED "…-plan" claiming Spec, a
 * bare `changelog` substring claiming Finalize for a product component, and
 * `gh pr view` claiming Merge. The classification rules and the command-position
 * anchoring are pinned here so a fourth cannot creep in quietly.
 */

import { describe, it, expect } from "vitest";

import { classifyEditPath, deriveStage } from "./stage-derivation";
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
      // Internal code review, FIX 3: the changelog/decision_log rule ran FIRST
      // and was a bare substring — the one place the guard had a hole, exactly
      // where the rule was loosest. `ChangelogPanel.tsx` is a product component.
      "/repo/client/src/components/ChangelogPanel.tsx",
      "/repo/src/lib/changelogParser.ts",
      "/repo/src/decision_logger.ts",
    ]) {
      expect(classifyEditPath(p)).toBe("product");
    }
  });

  it("still classifies the REAL changelog + decision log as finalize", () => {
    for (const p of [
      "/repo/CHANGELOG.md",
      "/repo/CHANGELOG-unreleased.d/Fixed/iterate-x_001.md",
      "/repo/.shipwright/agent_docs/decision_log.md",
    ]) {
      expect(classifyEditPath(p)).toBe("finalize");
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

describe("a shell command must DO the phase, not merely name it (FIX 4)", () => {
  const stageOf = (command: string) =>
    deriveStage(parse(slashCommand("shipwright-iterate"), toolUse("Bash", { command })), {
      scenario: "iterate",
    }).stage;

  // Same name-vs-evidence class as the slash-command Spec bug: `gh pr` matched
  // ANY `gh pr` subcommand, and polling a predecessor PR mid-iterate is routine
  // here — so an iterate still in Analyze read as Merge, the terminal stage.
  it("READING about a phase does not claim it", () => {
    expect(stageOf("gh pr view 297")).toBe("Analyze");
    expect(stageOf("gh pr list --state open")).toBe("Analyze");
    expect(stageOf("gh run list --limit 5")).toBe("Analyze");
    expect(stageOf("cat CHANGELOG.md")).toBe("Analyze");
    expect(stageOf("cat .shipwright/agent_docs/decision_log.md")).toBe("Analyze");
    expect(stageOf("cat vitest.config.ts")).toBe("Analyze");
    expect(stageOf("cat playwright.config.ts")).toBe("Analyze");
    expect(stageOf("grep -rn 'git commit' scripts/")).toBe("Analyze");
  });

  it("DOING it still claims it", () => {
    expect(stageOf("git push origin HEAD")).toBe("Merge");
    expect(stageOf("gh pr create --fill")).toBe("Merge");
    expect(stageOf("gh pr merge 7 --squash")).toBe("Merge");
    expect(stageOf("gh run watch")).toBe("Merge"); // pinned by a shipped FR-01.67 test
    expect(stageOf('git commit -m "feat: x"')).toBe("Finalize");
    expect(stageOf("npm run test")).toBe("Test");
    expect(stageOf("npm run build")).toBe("Build");
  });

  it("sees through env-var prefixes, runners and shell separators", () => {
    expect(stageOf("npx vitest run")).toBe("Test");
    expect(stageOf("SHIPWRIGHT_NETWORK_PROFILE=local npx vitest run")).toBe("Test");
    expect(stageOf("cd /repo && npm run test")).toBe("Test");
    expect(stageOf("cd /repo && git push origin HEAD")).toBe("Merge");
  });

  it("the iterate's own tooling is matched as an ARGUMENT, where it really appears", () => {
    // These never occupy a command position — the command is `uv run`.
    expect(stageOf('uv run ".../classify_complexity.py" --message x')).toBe("Analyze");
    expect(stageOf('uv run ".../finalize_iterate.py" --run-id x')).toBe("Finalize");
  });
});
