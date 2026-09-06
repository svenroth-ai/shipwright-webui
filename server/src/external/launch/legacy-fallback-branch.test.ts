/*
 * external/launch/legacy-fallback-branch.test.ts — FR-04.22 permission
 * perimeter (iterate-2026-09-06-claim-launch-permission-perimeter).
 *
 * `applyLegacyFallbackBranch` handles a claim-authorized launch for a task
 * that has never had `actionId` set — once a leadwright-created task's
 * `actionId` is persisted (the normal case: it's a required field on
 * leadwright's own side), `action-substitution-branch.ts` fires instead
 * (see `claim-executor-template-arming.test.ts`) because `parse-body.ts`'s
 * once-set-always-used contract resolves `actionId` from the persisted
 * task even when a claim-only `{ claimToken }` body omits it (Stage-1 spec
 * review finding). These tests assert on the produced COMMAND STRING, not
 * just that a field was set — the originating card's own requirement (c).
 */

import { describe, it, expect } from "vitest";

import { applyLegacyFallbackBranch } from "./legacy-fallback-branch.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { ParsedLaunchBody } from "./parse-body.js";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "T",
    sessionUuid: "11111111-1111-4111-8111-111111111111",
    cwd: "/repo",
    pluginDirs: [],
    state: "awaiting_external_start",
    title: "t",
    projectId: "p",
    createdAt: "2026-09-06T00:00:00.000Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

const PARSED: ParsedLaunchBody = {
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
};

describe("applyLegacyFallbackBranch — FR-04.22 permission perimeter", () => {
  it("a manual launch (claimAuthorized omitted) carries no --tools / --permission-mode flag", () => {
    const { commands } = applyLegacyFallbackBranch({
      task: makeTask(),
      parsed: PARSED,
      jsonlObserved: false,
    });
    for (const shellForm of [commands.powershell, commands.cmd, commands.posix]) {
      expect(shellForm).not.toContain("--tools");
      expect(shellForm).not.toContain("--permission-mode");
    }
  });

  it("a manual launch with claimAuthorized: false is byte-identical to claimAuthorized omitted", () => {
    const a = applyLegacyFallbackBranch({ task: makeTask(), parsed: PARSED, jsonlObserved: false });
    const b = applyLegacyFallbackBranch({
      task: makeTask(),
      parsed: PARSED,
      jsonlObserved: false,
      claimAuthorized: false,
    });
    expect(b.commands).toEqual(a.commands);
  });

  it("a claim-authorized launch carries an explicit --tools allow-list and --permission-mode on every shell form", () => {
    const { commands } = applyLegacyFallbackBranch({
      task: makeTask(),
      parsed: PARSED,
      jsonlObserved: false,
      claimAuthorized: true,
    });
    for (const shellForm of [commands.powershell, commands.cmd, commands.posix]) {
      expect(shellForm).toMatch(/--tools\s+["']?Bash,Read,Write,Edit,Glob,Grep["']?/);
      expect(shellForm).toMatch(/--permission-mode\s+["']?dontAsk["']?/);
    }
  });

  it("the claim-authorized allow-list does not include Bash-adjacent escalation tools (Task, WebFetch)", () => {
    const { commands } = applyLegacyFallbackBranch({
      task: makeTask(),
      parsed: PARSED,
      jsonlObserved: false,
      claimAuthorized: true,
    });
    expect(commands.posix).not.toMatch(/\bTask\b/);
    expect(commands.posix).not.toMatch(/\bWebFetch\b/);
  });
});
