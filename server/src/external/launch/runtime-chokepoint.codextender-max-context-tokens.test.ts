/*
 * runtime-chokepoint.codextender-max-context-tokens.test.ts — operator
 * finding (2026-09-26): Claude Code assumes a 200K context window for any
 * model id it doesn't recognize (the Codex alias) and over-compacts against
 * that wrong ceiling. Covers the launch chokepoint's `getCodextenderMaxContextTokens`
 * plumbing into `buildCodextenderCommands`. Split out of
 * runtime-chokepoint.codextender.test.ts (bloat anti-ratchet, its own
 * sibling-split pattern already used by runtime-chokepoint.model-override.test.ts)
 * as its own concern.
 */
import { describe, expect, it } from "vitest";

import { applyRuntimeChokepoint } from "./runtime-chokepoint.js";
import { buildCdPrefix } from "../../core/launcher.js";
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
    runtime: "codex",
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

// Same cd-prefix-matching requirement as the sibling test file — see its
// own comment for why TASK_CWD must agree with makeTask's default cwd.
const TASK_CWD = "/tmp/proj";
const CLAUDE_COMMANDS = {
  powershell: buildCdPrefix("powershell", TASK_CWD) + "claude-ps",
  cmd: buildCdPrefix("cmd", TASK_CWD) + "claude-cmd",
  posix: buildCdPrefix("posix", TASK_CWD) + "claude-posix",
};
const PROXY_UP = () => Promise.resolve(true);
const FIXTURE_TOKEN = () => "test-fixture-token";

describe("applyRuntimeChokepoint — Codextender max-context-tokens plumbing (operator finding, 2026-09-26)", () => {
  it("passes the resolved max context tokens through to buildCodextenderCommands, keyed on the launch's own model override", async () => {
    const task = makeTask();
    let modelPassedToProbe: string | undefined = "not-called";
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ codexImplementationModel: "astra" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      codextenderPort: 4000,
      checkCodextenderProxyAvailable: PROXY_UP,
      getCodextenderAuthToken: FIXTURE_TOKEN,
      getCodextenderMaxContextTokens: (model) => {
        modelPassedToProbe = model;
        return Promise.resolve(1_050_000);
      },
    });
    expect(modelPassedToProbe).toBe("astra");
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS='1050000'");
    }
  });

  it("leaves CLAUDE_CODE_MAX_CONTEXT_TOKENS unset when the probe resolves undefined (Claude Code's own 200K default), never a hardcoded guess", async () => {
    const task = makeTask();
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      codextenderPort: 4000,
      checkCodextenderProxyAvailable: PROXY_UP,
      getCodextenderAuthToken: FIXTURE_TOKEN,
      getCodextenderMaxContextTokens: () => Promise.resolve(undefined),
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).not.toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    }
  });
});
