import { describe, it, expect, vi, afterEach } from "vitest";

import { launchMasterRun } from "./masterRunApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("masterRunApi: launchMasterRun", () => {
  it("POSTs { masterRun: true } to the task's /launch endpoint (client never dictates the command)", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        task: { taskId: "t-1" },
        commands: { powershell: "p", cmd: "c", posix: "x" },
      }),
    }));
    vi.stubGlobal("fetch", spy);

    const out = await launchMasterRun("t-1");
    expect(out.task.taskId).toBe("t-1");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/external/tasks/t-1/launch");
    expect(init.method).toBe("POST");
    // The ONLY thing the client sends is the boolean intent — no command string.
    expect(JSON.parse(init.body as string)).toEqual({ masterRun: true });
  });

  it("adds resume:true for an established master (server → legacy --resume)", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ task: { taskId: "t-1" }, commands: { powershell: "", cmd: "", posix: "" } }),
    }));
    vi.stubGlobal("fetch", spy);

    await launchMasterRun("t-1", true);
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ masterRun: true, resume: true });
  });

  it("URL-encodes the taskId", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ task: { taskId: "a b" }, commands: { powershell: "", cmd: "", posix: "" } }),
    }));
    vi.stubGlobal("fetch", spy);

    await launchMasterRun("a b");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/external/tasks/a%20b/launch");
  });

  it("propagates a server rejection (e.g. 400 wrong-mode) as a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "master_launch_wrong_mode",
      })),
    );
    await expect(launchMasterRun("t-1")).rejects.toThrow(/HTTP 400/);
  });
});
