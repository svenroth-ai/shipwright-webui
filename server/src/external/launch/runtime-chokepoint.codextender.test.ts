/*
 * runtime-chokepoint.codextender.test.ts — Codextender integration Part
 * B.3/B.6: the chokepoint's Codextender branch (buildCodextenderCommands
 * instead of buildCodexCommands, a proxy probe instead of `codex
 * --version`), and the AC7/AC9 bypass for Codextender-mode launches.
 *
 * Split out of runtime-chokepoint.test.ts (its own sibling pattern —
 * runtime-chokepoint.model-override.test.ts already does the same) rather
 * than grown in place.
 */
import { describe, expect, it } from "vitest";

import { applyRuntimeChokepoint, isCodexCampaignBlocked, isCodexNewPipelineBlocked } from "./runtime-chokepoint.js";
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

// The task's own `cwd` (makeTask's default: "/tmp/proj") — a real
// buildCopyCommands output always embeds a cd-prefix built from THIS same
// cwd, and buildCodextenderCommands's cd-prefix match requires them to
// agree exactly (doubt-review HIGH, iterate-2026-09-23-codextender-webui-
// integration: it now throws on a mismatch rather than silently
// double-prefixing).
const TASK_CWD = "/tmp/proj";
const CLAUDE_COMMANDS = {
  powershell: buildCdPrefix("powershell", TASK_CWD) + "claude-ps",
  cmd: buildCdPrefix("cmd", TASK_CWD) + "claude-cmd",
  posix: buildCdPrefix("posix", TASK_CWD) + "claude-posix",
};
const PROXY_UP = () => Promise.resolve(true);
const PROXY_DOWN = () => Promise.resolve(false);
const FIXTURE_TOKEN = () => "test-fixture-token";

describe("isCodexNewPipelineBlocked — Codextender bypass (Part B.6)", () => {
  it("does NOT block a Codextender-mode task's new-pipeline launch (AC9 is a real-codex-CLI limitation)", () => {
    expect(
      isCodexNewPipelineBlocked(
        makeTask({ runtime: "codex" }),
        makeParsed({ actionId: "new-pipeline" }),
        "codextender",
      ),
    ).toBe(false);
  });

  it("still blocks a Codex-Light-mode task's new-pipeline launch", () => {
    expect(
      isCodexNewPipelineBlocked(
        makeTask({ runtime: "codex" }),
        makeParsed({ actionId: "new-pipeline" }),
        "light",
      ),
    ).toBe(true);
  });

  it("still blocks when codexIntegrationMode is unset (undefined defaults to the pre-existing behavior)", () => {
    expect(
      isCodexNewPipelineBlocked(makeTask({ runtime: "codex" }), makeParsed({ actionId: "new-pipeline" })),
    ).toBe(true);
  });
});

describe("isCodexCampaignBlocked — Codextender bypass (Part B.6)", () => {
  it("does NOT block a Codextender-mode task's campaign launch", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "codex" }), makeParsed({ campaignSlug: "slug-1" }), "codextender"),
    ).toBe(false);
  });

  it("still blocks a Codex-Light-mode task's campaign launch", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "codex" }), makeParsed({ campaignSlug: "slug-1" }), "light"),
    ).toBe(true);
  });
});

describe("applyRuntimeChokepoint — Codextender branch (Part B.3)", () => {
  it("overrides with buildCodextenderCommands (reusing the plain-Claude `commands`) for a Codextender-mode codex task", async () => {
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
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain("claude-posix");
      expect(result.commands.posix).toContain("ANTHROPIC_BASE_URL");
      expect(result.commands.posix).toContain("http://127.0.0.1:4000");
      expect(result.taskUpdate.state).toBe("awaiting_external_start");
      expect(result.taskUpdate.codexIntegrationMode).toBe("codextender");
    }
  });

  it("stamps codexIntegrationMode: 'light' on the ordinary Codex Light path (for symmetry)", async () => {
    const task = makeTask();
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: () => Promise.resolve(true),
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.taskUpdate.codexIntegrationMode).toBe("light");
    }
  });

  it("uses the given codextenderPort (defaulting to 4000 when omitted)", async () => {
    const task = makeTask();
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      checkCodextenderProxyAvailable: PROXY_UP,
      getCodextenderAuthToken: FIXTURE_TOKEN,
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain("http://127.0.0.1:4000");
    }
  });

  it("PR-review BLOCK (iterate-2026-09-23, second round) — blocks with codextender_auth_token_missing when no auth token is configured, even though the proxy is reachable", async () => {
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
      getCodextenderAuthToken: () => undefined,
    });
    expect("error" in result && result.status).toBe(400);
    if ("error" in result) {
      expect(result.error.error).toBe("codextender_auth_token_missing");
    }
  });

  it("blocks with codextender_proxy_unreachable when the proxy probe fails, WITHOUT ever probing the codex CLI", async () => {
    const task = makeTask();
    let codexCliProbed = false;
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      codextenderPort: 4100,
      checkCodextenderProxyAvailable: PROXY_DOWN,
      checkCodexCliAvailable: () => {
        codexCliProbed = true;
        return Promise.resolve(true);
      },
    });
    expect("error" in result && result.status).toBe(400);
    if ("error" in result) {
      expect(result.error.error).toBe("codextender_proxy_unreachable");
      expect(String(result.error.detail)).toContain("4100");
    }
    expect(codexCliProbed).toBe(false);
  });

  it("never reaches the AC7/AC9 blocks for a Codextender campaign/pipeline launch", async () => {
    const task = makeTask();
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ campaignSlug: "slug-1" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      checkCodextenderProxyAvailable: PROXY_UP,
      getCodextenderAuthToken: FIXTURE_TOKEN,
    });
    expect("commands" in result).toBe(true);
  });

  it("a Claude-runtime task is untouched by codexIntegrationMode/codextenderPort (byte-identical pass-through)", async () => {
    const task = makeTask({ runtime: "claude" });
    const taskUpdate = { state: "awaiting_external_start" as const };
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate,
      codexIntegrationMode: "codextender",
      codextenderPort: 4000,
    });
    expect(result).toEqual({ commands: CLAUDE_COMMANDS, taskUpdate });
  });

  it("doubt-review HIGH — refuses (codextender_cwd_mismatch, 500) rather than silently double-prefixing, when `commands` was built from a cwd OTHER than task.cwd (e.g. a custom action's project.path)", async () => {
    const task = makeTask();
    const commandsBuiltFromADifferentCwd = {
      powershell: buildCdPrefix("powershell", "/some/other/project") + "claude-ps",
      cmd: buildCdPrefix("cmd", "/some/other/project") + "claude-cmd",
      posix: buildCdPrefix("posix", "/some/other/project") + "claude-posix",
    };
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: commandsBuiltFromADifferentCwd,
      taskUpdate: {},
      codexIntegrationMode: "codextender",
      codextenderPort: 4000,
      checkCodextenderProxyAvailable: PROXY_UP,
      getCodextenderAuthToken: FIXTURE_TOKEN,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(500);
      expect(result.error.error).toBe("codextender_cwd_mismatch");
    }
  });
});
