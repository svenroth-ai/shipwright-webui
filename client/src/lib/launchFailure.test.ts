import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveLaunchFailure,
  parseServerErrorCode,
  type LaunchFailure,
} from "./launchFailure";

function server(code: string): LaunchFailure {
  const f = resolveLaunchFailure({ source: "server", code });
  expect(f).not.toBeNull();
  return f as LaunchFailure;
}

describe("launchFailure — the single mapping table (AC3/AC4)", () => {
  // ---- task-state signals ----
  // @covers FR-01.61
  it("maps launch_failed → Retry + Copy command + Open terminal", () => {
    const f = resolveLaunchFailure({ source: "task", state: "launch_failed" })!;
    expect(f.title).toBe("Launch failed");
    expect(f.actions).toEqual(["retry", "copy-command", "open-terminal"]);
  });

  // @covers FR-01.61
  it("maps jsonl_missing → Open terminal + Resume, NEVER Launch, and names the two causes + the path", () => {
    const f = resolveLaunchFailure({ source: "task", state: "jsonl_missing" })!;
    expect(f.actions).toEqual(["open-terminal", "resume"]);
    expect(f.actions).not.toContain("retry");
    expect(f.showPath).toBe(true);
    // Names both real causes (b) the child-session leak, (a) never ran.
    expect(f.sentence).toMatch(/CLAUDE_CODE_CHILD_SESSION=1/);
    expect(f.sentence).toMatch(/never actually ran/i);
  });

  // @covers FR-01.61
  it("a normal idle/active task is NOT a failure (returns null)", () => {
    expect(resolveLaunchFailure({ source: "task", state: "idle" })).toBeNull();
    expect(resolveLaunchFailure({ source: "task", state: "active" })).toBeNull();
    expect(resolveLaunchFailure({ source: "task", state: "done" })).toBeNull();
    expect(resolveLaunchFailure({ source: "task", state: "draft" })).toBeNull();
  });

  // @covers FR-01.61
  it("resume-recovery → Resume only, recovery tone", () => {
    const f = resolveLaunchFailure({ source: "resume-recovery" })!;
    expect(f.actions).toEqual(["resume"]);
    expect(f.tone).toBe("recovery");
  });

  // ---- permission-denied family: 403 / 422 get NO retry (the crux of AC3) ----
  // @covers FR-01.61
  it("403 path_traversal_rejected → NO retry (state the fix), show the path", () => {
    const f = server("path_traversal_rejected");
    expect(f.actions).not.toContain("retry");
    expect(f.actions).toEqual([]);
    expect(f.showPath).toBe(true);
  });

  // @covers FR-01.61
  it("422 no_writable_status_target → NO retry, show the dir", () => {
    const f = server("no_writable_status_target");
    expect(f.actions).not.toContain("retry");
    expect(f.actions).toEqual([]);
    expect(f.showPath).toBe(true);
  });

  // @covers FR-01.61
  it("503 lock_unavailable → Retry (genuinely transient)", () => {
    expect(server("lock_unavailable").actions).toEqual(["retry"]);
  });

  // @covers FR-01.61
  it("404 campaign_not_found / project_path_invalid → Open project settings, no retry", () => {
    expect(server("campaign_not_found").actions).toEqual(["open-project-settings"]);
    expect(server("project_path_invalid").actions).toEqual(["open-project-settings"]);
  });

  // @covers FR-01.61
  it("409 campaign_already_complete → Refresh (the card is stale)", () => {
    expect(server("campaign_already_complete").actions).toEqual(["refresh"]);
  });

  // @covers FR-01.61
  it("EACCES / EPERM → permission-denied, NO retry, show the path", () => {
    const f = server("EACCES");
    expect(f.code).toBe("permission_denied_path");
    expect(f.actions).toEqual([]);
    expect(server("EPERM: operation not permitted").actions).toEqual([]);
  });

  // ---- rule-13 codes surface, not swallowed ----
  // @covers FR-01.61
  it("409 phase_task_session_uuid_mismatch → a rendered Refresh notice (rule 13)", () => {
    const f = server("phase_task_session_uuid_mismatch");
    expect(f.title).toBe("Pipeline moved on");
    expect(f.actions).toEqual(["refresh"]);
  });

  // @covers FR-01.61
  it("400 mixed_launch_intents → a rendered notice (rule 13)", () => {
    expect(server("mixed_launch_intents").actions).toEqual(["refresh"]);
  });

  // @covers FR-01.61
  it("an unknown server code degrades to the launch-failed family (never a blank)", () => {
    const f = server("something_new_530");
    expect(f.code).toBe("something_new_530");
    expect(f.title).toBe("Launch failed");
    expect(f.actions).toContain("retry");
  });

  // ---- useContinuePipeline reasons (rule 14 vocabulary) ----
  it.each([
    ["no_run_config", ["refresh"]],
    ["phase_task_not_found", ["refresh"]],
    ["phase_task_not_actionable", ["refresh"]],
    ["phase_task_prereq_not_met", ["refresh"]],
    ["launch_failed", ["retry", "copy-command", "open-terminal"]],
  ] as const)("pipeline reason %s → %j", (reason, actions) => {
    const f = resolveLaunchFailure({ source: "pipeline", reason })!;
    expect(f.actions).toEqual(actions);
  });

  // ---- parseServerErrorCode: the httpJson thrown-message path ----
  // @covers FR-01.61
  it("parses the server code out of a thrown httpJson message", () => {
    const msg =
      'HTTP 409 /api/external/tasks/t-1/launch: {"error":"phase_task_session_uuid_mismatch","taskId":"t-1"}';
    expect(parseServerErrorCode(msg)).toBe("phase_task_session_uuid_mismatch");
  });

  // @covers FR-01.61
  it("maps a raw EACCES message onto permission_denied_path", () => {
    expect(parseServerErrorCode("EACCES: permission denied, open '/x'")).toBe(
      "permission_denied_path",
    );
  });

  // @covers FR-01.61
  it("returns null when there is no code to parse", () => {
    expect(parseServerErrorCode("network down")).toBeNull();
    expect(parseServerErrorCode(undefined)).toBeNull();
  });
});

// ---- AC5 / DO-NOT #11: the single source of words carries NO command literal ----
describe("launchFailure — DO-NOT #11 (no slash-command literal)", () => {
  // @covers FR-01.61
  it("has no /shipwright-* string in the words module", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "launchFailure.ts"), "utf8");
    expect(src).not.toMatch(/\/shipwright-/);
  });
});
