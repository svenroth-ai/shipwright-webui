/*
 * runtime-chokepoint.test.ts — Codex Light §2.1 main-route chokepoint,
 * AC9's new-pipeline block, and AC7's campaign block.
 */
import { describe, expect, it } from "vitest";

import {
  applyRuntimeChokepoint,
  isCodexNewPipelineBlocked,
  isCodexCampaignBlocked,
} from "./runtime-chokepoint.js";
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
    ...over,
  };
}

const CLAUDE_COMMANDS = { powershell: "claude-ps", cmd: "claude-cmd", posix: "claude-posix" };

describe("isCodexNewPipelineBlocked — AC9", () => {
  it("blocks a codex task's new-pipeline launch", () => {
    expect(
      isCodexNewPipelineBlocked(makeTask({ runtime: "codex" }), makeParsed({ actionId: "new-pipeline" })),
    ).toBe(true);
  });

  it("does not block a claude task's new-pipeline launch", () => {
    expect(
      isCodexNewPipelineBlocked(makeTask({ runtime: "claude" }), makeParsed({ actionId: "new-pipeline" })),
    ).toBe(false);
  });

  it("keys on actionId, not phase — a phase-only submission never blocks", () => {
    // A pipeline launch never submits `phase` (useNewIssueFormSubmit.ts);
    // asserting the check ignores it proves the AC9 correction landed.
    expect(
      isCodexNewPipelineBlocked(
        makeTask({ runtime: "codex" }),
        makeParsed({ actionId: "new-task", phase: "new-pipeline" }),
      ),
    ).toBe(false);
  });
});

describe("isCodexCampaignBlocked — AC7", () => {
  it("blocks a codex task's campaignSlug launch", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "codex" }), makeParsed({ campaignSlug: "slug-1" })),
    ).toBe(true);
  });

  it("blocks a codex task's campaignStep launch", () => {
    expect(
      isCodexCampaignBlocked(
        makeTask({ runtime: "codex" }),
        makeParsed({ campaignStep: { slug: "slug-1", stepId: "step-1" } }),
      ),
    ).toBe(true);
  });

  it("blocks a codex task's masterRun launch", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "codex" }), makeParsed({ masterRun: true })),
    ).toBe(true);
  });

  it("does not block a claude task's campaign launch", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "claude" }), makeParsed({ campaignSlug: "slug-1" })),
    ).toBe(false);
  });

  it("does not block an ordinary codex launch with no campaign intent", () => {
    expect(
      isCodexCampaignBlocked(makeTask({ runtime: "codex" }), makeParsed({ actionId: "new-task" })),
    ).toBe(false);
  });
});

const CODEX_CLI_PRESENT = () => Promise.resolve(true);
const CODEX_CLI_MISSING = () => Promise.resolve(false);

describe("applyRuntimeChokepoint", () => {
  // @covers FR-01.74
  it("passes claude commands/taskUpdate through byte-identical", async () => {
    const task = makeTask({ runtime: "claude" });
    const taskUpdate = { state: "awaiting_external_start" as const };
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate,
    });
    expect(result).toEqual({ commands: CLAUDE_COMMANDS, taskUpdate });
  });

  it("returns the AC9 block error for a codex new-pipeline launch", async () => {
    const task = makeTask({ runtime: "codex" });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ actionId: "new-pipeline" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
    });
    expect("error" in result && result.status).toBe(400);
    if ("error" in result) {
      expect(result.error.error).toBe("codex_new_pipeline_unsupported");
    }
  });

  it("returns the AC7 block error for a codex campaign launch, before any command override", async () => {
    const task = makeTask({ runtime: "codex" });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ campaignSlug: "slug-1" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
    });
    expect("error" in result && result.status).toBe(400);
    if ("error" in result) {
      expect(result.error.error).toBe("codex_campaign_unsupported");
    }
  });

  it("overrides with buildCodexCommands for a fresh codex task (no threadId → not a resume)", async () => {
    const task = makeTask({ runtime: "codex", threadId: undefined });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed({ autonomy: "autonomous", description: "do the thing" }),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: CODEX_CLI_PRESENT,
    });
    expect("commands" in result).toBe(true);
    if ("commands" in result) {
      expect(result.commands.posix).toContain("codex ");
      expect(result.commands.posix).not.toContain("codex resume");
      expect(result.taskUpdate.state).toBe("awaiting_external_start");
    }
  });

  it("emits `codex resume <threadId>` once a threadId is already known", async () => {
    const task = makeTask({ runtime: "codex", threadId: "thread-xyz" });
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
      expect(result.commands.posix).toContain("codex resume");
      expect(result.commands.posix).toContain("'thread-xyz'");
    }
  });

  // AC8 (external-code-review finding) — a task launched with a runtime
  // whose CLI isn't installed must fail at launch time with one actionable
  // message, independent of the readiness probe's own gate.
  it("blocks a codex launch with codex_cli_not_found when the CLI isn't installed", async () => {
    const task = makeTask({ runtime: "codex" });
    const result = await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: CODEX_CLI_MISSING,
    });
    expect("error" in result && result.status).toBe(400);
    if ("error" in result) {
      expect(result.error.error).toBe("codex_cli_not_found");
      expect(String(result.error.detail)).toMatch(/codex/i);
    }
  });

  it("never probes the CLI for a claude-runtime task (byte-identical pass-through stays synchronous in spirit)", async () => {
    const task = makeTask({ runtime: "claude" });
    let probed = false;
    await applyRuntimeChokepoint({
      task,
      parsed: makeParsed(),
      project: undefined,
      commands: CLAUDE_COMMANDS,
      taskUpdate: {},
      checkCodexCliAvailable: () => {
        probed = true;
        return Promise.resolve(true);
      },
    });
    expect(probed).toBe(false);
  });
});
