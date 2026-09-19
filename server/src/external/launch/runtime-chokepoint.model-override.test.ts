/*
 * runtime-chokepoint.model-override.test.ts —
 * iterate-2026-09-17-codex-model-tier-parameterization.
 *
 * Split out of runtime-chokepoint.test.ts (which crossed the 300-LOC
 * guideline) rather than grown in place — same helpers, dedicated concern:
 * the codexImplementationModel override threading through
 * applyRuntimeChokepoint into buildCodexCommands.
 */
import { describe, expect, it } from "vitest";

import { applyRuntimeChokepoint } from "./runtime-chokepoint.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { ParsedLaunchBody } from "./parse-body.js";

function makeTask(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "t1",
    sessionUuid: "uuid-1",
    cwd: "/tmp/proj",
    pluginDirs: [],
    state: "draft",
    title: "T",
    projectId: "proj-1",
    runtime: "claude",
    createdAt: "2026-01-01T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

function makeParsed(over: Partial<ParsedLaunchBody> = {}): ParsedLaunchBody {
  return {
    resume: false,
    dryRun: false,
    actionId: undefined,
    phase: undefined,
    phaseLabel: undefined,
    description: undefined,
    autonomy: undefined,
    userParams: undefined,
    phaseTaskRefRaw: undefined,
    campaignSlug: undefined,
    campaignStep: undefined,
    masterRun: false,
    codexImplementationModel: undefined,
    ...over,
  };
}

const CLAUDE_COMMANDS = { powershell: "claude-ps", cmd: "claude-cmd", posix: "claude-posix" };
const CODEX_CLI_PRESENT = () => Promise.resolve(true);

describe("applyRuntimeChokepoint — codexImplementationModel override", () => {
  it("threads a codexImplementationModel override into buildCodexCommands", async () => {
    const task = makeTask({ runtime: "codex", threadId: undefined });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ codexImplementationModel: "gpt-5.6-luna" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: CODEX_CLI_PRESENT,
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain(`-c 'model="gpt-5.6-luna"'`);
    }
  });

  it("emits no -c model= flag for a codex task with no override", async () => {
    const task = makeTask({ runtime: "codex", threadId: undefined });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: CODEX_CLI_PRESENT,
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).not.toContain("model=");
    }
  });

  it("threads the override through a resume launch too", async () => {
    const task = makeTask({ runtime: "codex", threadId: "thread-xyz" });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ codexImplementationModel: "gpt-5.6-sol" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: CODEX_CLI_PRESENT,
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain("codex resume");
      expect(result.commands.posix).toContain(`-c 'model="gpt-5.6-sol"'`);
    }
  });
});
