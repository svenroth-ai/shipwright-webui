import { describe, it, expect, vi, beforeEach } from "vitest";

import { launchCampaignStep } from "./useLaunchCampaignStep";
import type { CopyCommandForms } from "../lib/externalApi";

const COMMANDS: CopyCommandForms = { powershell: "p", cmd: "c", posix: "x" };

function deps(overrides: Partial<Parameters<typeof launchCampaignStep>[1]> = {}) {
  return {
    create: vi.fn(async () => ({ taskId: "t-1" })),
    launch: vi.fn(async () => ({ task: { taskId: "t-1" }, commands: COMMANDS })),
    handoff: vi.fn(),
    ...overrides,
  };
}

describe("launchCampaignStep", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  // @covers FR-01.33
  it("creates a step task titled '<slug> · <stepId>', launches it, hands off, returns ok", async () => {
    const d = deps();
    const res = await launchCampaignStep(
      { project: { id: "p1", path: "/proj" }, slug: "2026-06-02-x", stepId: "C1" },
      d,
    );
    expect(res).toEqual({ ok: true, taskId: "t-1", commands: COMMANDS });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "2026-06-02-x · C1", cwd: "/proj", projectId: "p1" }),
    );
    expect(d.launch).toHaveBeenCalledWith("t-1", "2026-06-02-x", "C1");
    expect(d.handoff).toHaveBeenCalledWith("t-1", COMMANDS);
  });

  // @covers FR-01.33
  it("default handoff writes the pending-auto-launch sessionStorage key (resume:false)", async () => {
    const d = deps({ handoff: undefined });
    await launchCampaignStep(
      { project: { id: "p1", path: "/proj" }, slug: "s", stepId: "C1" },
      d,
    );
    const raw = window.sessionStorage.getItem("webui:pending-auto-launch:t-1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { commands: CopyCommandForms; resume: boolean };
    expect(parsed.commands.posix).toBe("x");
    expect(parsed.resume).toBe(false);
  });

  // @covers FR-01.33
  it("returns create_failed and never launches when createTask throws", async () => {
    const d = deps({
      create: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const res = await launchCampaignStep(
      { project: { id: "p1", path: "/p" }, slug: "s", stepId: "C1" },
      d,
    );
    expect(res).toMatchObject({ ok: false, reason: "create_failed" });
    expect(d.launch).not.toHaveBeenCalled();
  });

  // @covers FR-01.33
  it("returns launch_failed when the step launch is rejected (e.g. spec missing)", async () => {
    const d = deps({
      launch: vi.fn(async () => {
        throw new Error("HTTP 400 campaign_step_spec_missing");
      }),
    });
    const res = await launchCampaignStep(
      { project: { id: "p1", path: "/p" }, slug: "s", stepId: "C1" },
      d,
    );
    expect(res).toMatchObject({ ok: false, reason: "launch_failed" });
    if (!res.ok) expect(res.detail).toMatch(/campaign_step_spec_missing/);
  });
});
