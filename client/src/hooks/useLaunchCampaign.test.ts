import { describe, it, expect, vi, beforeEach } from "vitest";

import { launchCampaign } from "./useLaunchCampaign";
import type { CopyCommandForms } from "../lib/externalApi";

const COMMANDS: CopyCommandForms = { powershell: "p", cmd: "c", posix: "x" };

function deps(overrides: Partial<Parameters<typeof launchCampaign>[1]> = {}) {
  return {
    create: vi.fn(async () => ({ taskId: "t-1" })),
    launch: vi.fn(async () => ({ task: { taskId: "t-1" }, commands: COMMANDS })),
    handoff: vi.fn(),
    ...overrides,
  };
}

describe("launchCampaign", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("creates a campaign-runner task, launches it, hands off, returns ok", async () => {
    const d = deps();
    const res = await launchCampaign(
      { project: { id: "p1", path: "/proj" }, slug: "2026-06-02-x" },
      d,
    );
    expect(res).toEqual({ ok: true, taskId: "t-1", commands: COMMANDS });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "campaign: 2026-06-02-x", cwd: "/proj", projectId: "p1" }),
    );
    expect(d.launch).toHaveBeenCalledWith("t-1", "2026-06-02-x");
    expect(d.handoff).toHaveBeenCalledWith("t-1", COMMANDS);
  });

  it("default handoff writes the pending-auto-launch sessionStorage key (resume:false)", async () => {
    const d = deps({ handoff: undefined });
    await launchCampaign({ project: { id: "p1", path: "/proj" }, slug: "s" }, d);
    const raw = window.sessionStorage.getItem("webui:pending-auto-launch:t-1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { commands: CopyCommandForms; resume: boolean };
    expect(parsed.commands.posix).toBe("x");
    expect(parsed.resume).toBe(false);
  });

  it("returns create_failed and never launches when createTask throws", async () => {
    const d = deps({
      create: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const res = await launchCampaign({ project: { id: "p1", path: "/p" }, slug: "s" }, d);
    expect(res).toMatchObject({ ok: false, reason: "create_failed" });
    expect(d.launch).not.toHaveBeenCalled();
  });

  it("returns launch_failed when the campaign launch is rejected (e.g. invalid slug)", async () => {
    const d = deps({
      launch: vi.fn(async () => {
        throw new Error("HTTP 400 invalid_campaign_slug");
      }),
    });
    const res = await launchCampaign({ project: { id: "p1", path: "/p" }, slug: "s" }, d);
    expect(res).toMatchObject({ ok: false, reason: "launch_failed" });
    if (!res.ok) expect(res.detail).toMatch(/invalid_campaign_slug/);
  });
});
