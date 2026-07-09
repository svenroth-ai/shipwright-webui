import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  startMasterRun,
  type MasterShadowCandidate,
} from "./useLaunchMasterRun";
import type { CopyCommandForms } from "../lib/externalApi";

const COMMANDS: CopyCommandForms = {
  powershell: "p",
  cmd: "c",
  posix: "cd /proj && claude --session-id u --add-dir /proj --name 'Run-a1b2 master' '/shipwright-run'",
};

const RUN_ID = "run-a1b2c3d4";

function deps(overrides: Partial<Parameters<typeof startMasterRun>[1]> = {}) {
  return {
    create: vi.fn(async () => ({ taskId: "t-1" })),
    launch: vi.fn(async () => ({ commands: COMMANDS })),
    handoff: vi.fn(),
    ...overrides,
  };
}

function args(tasks: MasterShadowCandidate[] = []) {
  return {
    project: { id: "p1", path: "/proj" },
    config: { runId: RUN_ID },
    tasks,
  };
}

describe("startMasterRun", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("creates a master shadow, fresh-launches it, hands off, returns ok (reused:false, resume:false)", async () => {
    const d = deps();
    const res = await startMasterRun(args(), d);
    expect(res).toEqual({
      ok: true,
      taskId: "t-1",
      commands: COMMANDS,
      reused: false,
      resume: false,
    });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Run-a1b2 master",
        cwd: "/proj",
        projectId: "p1",
        runId: RUN_ID,
        parentRunMaster: true,
      }),
    );
    expect(d.launch).toHaveBeenCalledWith("t-1", false);
    expect(d.handoff).toHaveBeenCalledWith("t-1", COMMANDS, false);
  });

  it("idempotent: reuses an existing but never-launched master shadow → still a FRESH launch", async () => {
    const d = deps();
    const existing: MasterShadowCandidate = {
      taskId: "t-master",
      runId: RUN_ID,
      parentRunMaster: true,
      // no firstJsonlObservedAt → never launched → fresh.
    };
    const res = await startMasterRun(args([existing]), d);
    expect(res).toMatchObject({ ok: true, taskId: "t-master", reused: true, resume: false });
    expect(d.create).not.toHaveBeenCalled();
    expect(d.launch).toHaveBeenCalledWith("t-master", false);
  });

  it("reusing an ESTABLISHED master (JSONL on disk) issues a RESUME, not a fresh launch", async () => {
    const d = deps();
    const established: MasterShadowCandidate = {
      taskId: "t-master",
      runId: RUN_ID,
      parentRunMaster: true,
      firstJsonlObservedAt: "2026-07-09T00:00:00.000Z",
    };
    const res = await startMasterRun(args([established]), d);
    expect(res).toMatchObject({ ok: true, taskId: "t-master", reused: true, resume: true });
    expect(d.create).not.toHaveBeenCalled();
    // resume=true → server falls through to the legacy `--resume <uuid>` shape;
    // a fresh `--session-id` re-inject would be rejected as a duplicate session.
    expect(d.launch).toHaveBeenCalledWith("t-master", true);
    expect(d.handoff).toHaveBeenCalledWith("t-master", COMMANDS, true);
  });

  it("does NOT reuse a master shadow from a DIFFERENT run", async () => {
    const d = deps();
    const otherRunMaster: MasterShadowCandidate = {
      taskId: "t-other",
      runId: "run-99999999",
      parentRunMaster: true,
    };
    const res = await startMasterRun(args([otherRunMaster]), d);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.taskId).toBe("t-1");
    expect(d.create).toHaveBeenCalledOnce();
  });

  it("does NOT treat a non-master task with the same runId as the master shadow", async () => {
    const d = deps();
    const phaseShadow: MasterShadowCandidate = {
      taskId: "t-phase",
      runId: RUN_ID,
      parentRunMaster: false,
      firstJsonlObservedAt: "2026-07-09T00:00:00.000Z",
    };
    const res = await startMasterRun(args([phaseShadow]), d);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.taskId).toBe("t-1");
    expect(d.create).toHaveBeenCalledOnce();
  });

  it("default handoff writes the pending-auto-launch sessionStorage key (resume:false for a fresh master)", async () => {
    const d = deps({ handoff: undefined });
    await startMasterRun(args(), d);
    const raw = window.sessionStorage.getItem("webui:pending-auto-launch:t-1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { commands: CopyCommandForms; resume: boolean };
    expect(parsed.commands.posix).toContain("/shipwright-run");
    expect(parsed.resume).toBe(false);
  });

  it("returns create_failed and never launches when createTask throws", async () => {
    const d = deps({
      create: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const res = await startMasterRun(args(), d);
    expect(res).toMatchObject({ ok: false, reason: "create_failed" });
    expect(d.launch).not.toHaveBeenCalled();
  });

  it("returns launch_failed when the master launch is rejected (e.g. wrong mode)", async () => {
    const d = deps({
      launch: vi.fn(async () => {
        throw new Error("HTTP 400 master_launch_wrong_mode");
      }),
    });
    const res = await startMasterRun(args(), d);
    expect(res).toMatchObject({ ok: false, reason: "launch_failed" });
    if (!res.ok) expect(res.detail).toMatch(/master_launch_wrong_mode/);
  });
});
