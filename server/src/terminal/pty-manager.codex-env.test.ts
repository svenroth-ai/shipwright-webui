/*
 * pty-manager.codex-env.test.ts — Codex Light §2.4: `PtySpawnOpts.env` must
 * thread through `spawn()` to the injected `PtySpawnFn` unchanged.
 */
import { describe, expect, it } from "vitest";

import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";

function fakePty(): PtyHandleApi {
  return {
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
  };
}

describe("PtyManager.spawn — env passthrough", () => {
  it("forwards opts.env to the injected spawn function", () => {
    const calls: Array<{ env?: Record<string, string | undefined> }> = [];
    const spawn: PtySpawnFn = (_shell, _args, opts) => {
      calls.push({ env: opts.env });
      return fakePty();
    };
    const mgr = new PtyManager({ spawn });
    mgr.spawn("t1", {
      cwd: "/tmp",
      shell: "bash",
      env: { SHIPWRIGHT_SESSION_ID: "sess-1" },
    });
    expect(calls[0].env).toEqual({ SHIPWRIGHT_SESSION_ID: "sess-1" });
  });

  it("passes env=undefined through when omitted (Claude tasks)", () => {
    const calls: Array<{ env?: Record<string, string | undefined> }> = [];
    const spawn: PtySpawnFn = (_shell, _args, opts) => {
      calls.push({ env: opts.env });
      return fakePty();
    };
    const mgr = new PtyManager({ spawn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    expect(calls[0].env).toBeUndefined();
  });
});
