/*
 * useWizardLaunch orchestrator tests (A09a, FR-01.52 — AC3/AC6).
 *
 * RED on pre-A09a main (the module does not exist), green after. Drives the
 * pure `launchWizardDoor` with injected deps so the full create → task → launch
 * → handoff → navigate contract is asserted without React or a live server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { launchWizardDoor, writePendingAutoLaunch } from "./useWizardLaunch";
import { buildNewLaunchRequest, buildAdoptLaunchRequest } from "./contract";
import type { CopyCommandForms } from "../../../lib/externalApi";

const COMMANDS: CopyCommandForms = { powershell: "p", cmd: "c", posix: "x" };

function deps(overrides: Partial<Parameters<typeof launchWizardDoor>[1]> = {}) {
  return {
    createProject: vi.fn(async () => ({ id: "proj-1", path: "C:\\dev\\yoga" })),
    createTask: vi.fn(async () => ({ taskId: "t-1", sessionUuid: "uuid-1", projectId: "proj-1" })),
    launch: vi.fn(async () => ({ commands: COMMANDS })),
    handoff: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

const NEW_REQ = buildNewLaunchRequest(
  { brief: "A booking tool", who: "My team", remember: "No", where: "On the web" },
  { name: "yoga", path: "C:\\dev\\yoga" },
);

describe("launchWizardDoor — New door", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("creates project → task → launches with actionId + brief, hands off, navigates (AC3)", async () => {
    const d = deps();
    const res = await launchWizardDoor(NEW_REQ, d);

    expect(res).toEqual({
      ok: true,
      response: { projectId: "proj-1", taskId: "t-1", sessionUuid: "uuid-1" },
      commands: COMMANDS,
    });
    expect(d.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "yoga", path: "C:\\dev\\yoga", profile: "vite-hono" }),
    );
    // AC3 — the create task AND launch bodies both carry actionId + the brief.
    expect(d.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "new-pipeline",
        description: expect.stringContaining("A booking tool"),
        projectId: "proj-1",
        cwd: "C:\\dev\\yoga",
        pluginDirs: [],
      }),
    );
    expect(d.launch).toHaveBeenCalledWith(
      "t-1",
      expect.objectContaining({
        actionId: "new-pipeline",
        description: expect.stringContaining("A booking tool"),
      }),
    );
    expect(d.handoff).toHaveBeenCalledWith("t-1", COMMANDS);
    expect(d.navigate).toHaveBeenCalledWith("/tasks/t-1");
  });
});

describe("launchWizardDoor — Adopt door", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("launches new-task + adopt phase (→ /shipwright-adopt) with a non-empty brief (AC2/AC3)", async () => {
    const d = deps({
      createProject: vi.fn(async () => ({ id: "proj-2", path: "C:\\work\\api-server" })),
      createTask: vi.fn(async () => ({ taskId: "t-2", sessionUuid: "uuid-2", projectId: "proj-2" })),
    });
    const res = await launchWizardDoor(buildAdoptLaunchRequest("C:\\work\\api-server"), d);

    expect(res.ok).toBe(true);
    expect(d.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "new-task", phase: "adopt", cwd: "C:\\work\\api-server" }),
    );
    // AC3 — the /launch body routes to /shipwright-adopt (new-task + adopt phase)
    // AND carries a non-empty brief.
    expect(d.launch).toHaveBeenCalledWith(
      "t-2",
      expect.objectContaining({
        actionId: "new-task",
        phase: "adopt",
        phaseLabel: "Adopt",
        description: expect.stringContaining("api-server"),
      }),
    );
    expect(d.navigate).toHaveBeenCalledWith("/tasks/t-2");
  });
});

describe("launchWizardDoor — fails CLOSED (never a half-launch)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("create_project_failed → never creates a task or navigates", async () => {
    const d = deps({
      createProject: vi.fn(async () => {
        throw new Error("EACCES mkdir");
      }),
    });
    const res = await launchWizardDoor(NEW_REQ, d);
    expect(res).toMatchObject({ ok: false, reason: "create_project_failed" });
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("create_task_failed → never launches or navigates", async () => {
    const d = deps({
      createTask: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const res = await launchWizardDoor(NEW_REQ, d);
    expect(res).toMatchObject({ ok: false, reason: "create_task_failed" });
    expect(d.launch).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("launch_failed (e.g. unknown_action_id) → never navigates", async () => {
    const d = deps({
      launch: vi.fn(async () => {
        throw new Error("HTTP 400 unknown_action_id");
      }),
    });
    const res = await launchWizardDoor(NEW_REQ, d);
    expect(res).toMatchObject({ ok: false, reason: "launch_failed" });
    if (!res.ok) expect(res.detail).toMatch(/unknown_action_id/);
    expect(d.navigate).not.toHaveBeenCalled();
  });
});

describe("sessionStorage handoff — round-trip with the TaskDetailPage consumer", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("default handoff writes the exact key + envelope TaskDetailPage reads", async () => {
    const d = deps({ handoff: undefined });
    await launchWizardDoor(NEW_REQ, d);
    // Consumer contract (TaskDetailPage): `webui:pending-auto-launch:<taskId>`,
    // JSON { commands, resume:false, ts }.
    const raw = window.sessionStorage.getItem("webui:pending-auto-launch:t-1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { commands: CopyCommandForms; resume: boolean; ts: number };
    expect(parsed.commands).toEqual(COMMANDS);
    expect(parsed.resume).toBe(false);
    expect(typeof parsed.ts).toBe("number");
  });

  it("writePendingAutoLaunch is a no-op-safe producer (privacy mode swallows errors)", () => {
    // The producer must never throw even if sessionStorage is unavailable.
    expect(() => writePendingAutoLaunch("tX", COMMANDS)).not.toThrow();
    const raw = window.sessionStorage.getItem("webui:pending-auto-launch:tX");
    expect(JSON.parse(raw!).commands.posix).toBe("x");
  });
});
