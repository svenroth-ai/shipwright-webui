/*
 * leadwright-preflight-transport.test.ts — the subprocess transport that
 * calls leadwright's `scripts/check-setup.ts --stdin --json` (W14,
 * iterate-2026-09-07-leadwright-setup-wizard).
 *
 * Corrections this module is built against (verified against leadwright
 * origin/main @ 43fcd492, see the iterate spec):
 *   1. stdin MUST be explicitly closed (child.stdin.end()) — the CLI's own
 *      STDIN_TIMEOUT_MS=30_000 hangs otherwise.
 *   2. Exit code is NOT the fail-closed signal — stdout parses as a
 *      PreflightResult ⇒ ranOk:true (verdict may still be ok:false);
 *      stdout empty/unparsable ⇒ ranOk:false, regardless of exit code.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { runLeadwrightPreflight } from "./leadwright-preflight-transport.js";
import type { PreflightStdinInput } from "../types/leadwright-preflight.js";

/** A minimal fake ChildProcess: EventEmitter + stdin/stdout/stderr streams
 *  + a spy-able kill(). Sufficient surface for the transport module. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

const MINIMAL_PROPOSAL: PreflightStdinInput = {
  orgChart: { version: 2, po: "po", leads: {} },
  charters: [],
  daemonConfig: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" },
};

describe("runLeadwrightPreflight", () => {
  it("writes the proposal to stdin as JSON and closes it (correction 3)", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const stdinEndSpy = vi.spyOn(child.stdin, "end");
    let written = "";
    child.stdin.on("data", (chunk: Buffer) => {
      written += chunk.toString("utf-8");
    });

    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: ["scripts/check-setup.ts", "--stdin", "--json"] }),
    });

    // Let the stdin write flush before closing the stream from the child side.
    await new Promise((r) => setImmediate(r));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ ok: true, findings: [] })));
    child.emit("close", 0, null);

    const result = await resultPromise;
    expect(JSON.parse(written)).toEqual(MINIMAL_PROPOSAL);
    expect(stdinEndSpy).toHaveBeenCalled();
    expect(result).toEqual({ ranOk: true, result: { ok: true, findings: [] } });
  });

  it("ranOk:true on a RED verdict (exit code 1) — parse success, not exit code, is the signal (correction 4)", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
    });
    await new Promise((r) => setImmediate(r));
    const redResult = { ok: false, findings: [{ key: "x", layer: "MUSS", satisfied: false, message: "nope" }] };
    child.stdout.emit("data", Buffer.from(JSON.stringify(redResult)));
    child.emit("close", 1, null);

    expect(await resultPromise).toEqual({ ranOk: true, result: redResult });
  });

  it("ranOk:false when stdout is empty, even though this is exactly the malformed-stdin path's real signature (correction 4)", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
    });
    await new Promise((r) => setImmediate(r));
    child.stderr.emit("data", Buffer.from("leadwright check: --stdin input is not valid JSON: ..."));
    child.emit("close", 1, null);

    const result = await resultPromise;
    expect(result.ranOk).toBe(false);
    expect((result as { ranOk: false; reason: string }).reason).toContain("--stdin input is not valid JSON");
  });

  it("ranOk:false when stdout is unparsable JSON", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
    });
    await new Promise((r) => setImmediate(r));
    child.stdout.emit("data", Buffer.from("not json{"));
    child.emit("close", 1, null);

    const result = await resultPromise;
    expect(result.ranOk).toBe(false);
  });

  it("ranOk:false when resolveSpawn cannot place tsx on disk (returns null)", async () => {
    const spawnFn = vi.fn();
    const result = await runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => null,
    });
    expect(result).toEqual({
      ranOk: false,
      reason: expect.stringContaining("tsx"),
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("ranOk:false on a spawn 'error' event (child could not launch at all)", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
    });
    await new Promise((r) => setImmediate(r));
    child.emit("error", new Error("ENOENT"));

    const result = await resultPromise;
    expect(result.ranOk).toBe(false);
    expect((result as { ranOk: false; reason: string }).reason).toContain("could not spawn");
  });

  it("kills the child and resolves ranOk:false('timeout') after the wall-clock deadline, distinct from the CLI's own stdin timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
      const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
        spawn: spawnFn as never,
        resolveSpawnFn: () => ({ command: "tsx", args: [] }),
        timeoutMs: 5000,
      });
      await vi.advanceTimersByTimeAsync(5001);
      const result = await resultPromise;
      expect(child.kill).toHaveBeenCalled();
      expect(result.ranOk).toBe(false);
      expect((result as { ranOk: false; reason: string }).reason.toLowerCase()).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not double-resolve when 'close' fires after the timeout already settled the promise", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
      const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
        spawn: spawnFn as never,
        resolveSpawnFn: () => ({ command: "tsx", args: [] }),
        timeoutMs: 5000,
      });
      await vi.advanceTimersByTimeAsync(5001);
      const result = await resultPromise;
      // A late 'close' after the kill must not throw / must not change the result.
      child.stdout.emit("data", Buffer.from(JSON.stringify({ ok: true, findings: [] })));
      child.emit("close", null, "SIGTERM");
      expect(result.ranOk).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranOk:false when the proposal exceeds the collected-output byte cap (a runaway child never gets its truncated stdout parsed)", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
      maxOutputBytes: 10,
    });
    await new Promise((r) => setImmediate(r));
    child.stdout.emit("data", Buffer.from("this is way more than ten bytes of output"));

    const result = await resultPromise;
    expect(child.kill).toHaveBeenCalled();
    expect(result.ranOk).toBe(false);
    expect((result as { ranOk: false; reason: string }).reason.toLowerCase()).toContain("output");
  });

  it("stdin write errors (EPIPE) do not crash the call — surfaced via the eventual close/stderr path", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawnFn>);
    const resultPromise = runLeadwrightPreflight("/checkout", MINIMAL_PROPOSAL, {
      spawn: spawnFn as never,
      resolveSpawnFn: () => ({ command: "tsx", args: [] }),
    });
    await new Promise((r) => setImmediate(r));
    child.stdin.emit("error", new Error("EPIPE"));
    child.emit("close", 1, null);

    const result = await resultPromise;
    expect(result.ranOk).toBe(false);
  });
});
