import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import type { spawn as realSpawn } from "node:child_process";

import {
  drainStdio,
  treeKill,
  awaitExit,
  defaultProbePort,
  buildReadyUrl,
  defaultProbeReady,
} from "./preview-child-lifecycle.js";

// Branch/edge coverage for the preview-child-lifecycle helpers: the drain
// setEncoding path, every treeKill fallback, awaitExit's fast/late paths, and
// the port/readiness probes (exported but previously exercised only indirectly
// through the manager's injected seams).

describe("drainStdio — setEncoding branch", () => {
  it("calls setEncoding('utf8') on streams that support it", () => {
    const mk = () =>
      Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    const stdout = mk();
    const stderr = mk();
    const d = drainStdio({ stdout, stderr } as never);
    expect(stdout.setEncoding).toHaveBeenCalledWith("utf8");
    expect(stderr.setEncoding).toHaveBeenCalledWith("utf8");
    // still drains after decoding is set
    stdout.emit("data", "hello");
    expect(d.tail()).toBe("hello");
  });
});

describe("treeKill — fallback branches", () => {
  it("win32: no usable pid → direct kill, never taskkill", () => {
    const killSpawn = vi.fn();
    const child = { pid: 0, kill: vi.fn(() => true) };
    treeKill(child, "SIGTERM", {
      platform: "win32",
      killSpawn: killSpawn as unknown as typeof realSpawn,
    });
    expect(killSpawn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("win32: taskkill spawn throwing falls back to a direct kill", () => {
    const killSpawn = vi.fn(() => {
      throw new Error("spawn taskkill ENOENT");
    });
    const child = { pid: 4242, kill: vi.fn(() => true) };
    treeKill(child, "SIGTERM", {
      platform: "win32",
      killSpawn: killSpawn as unknown as typeof realSpawn,
    });
    expect(killSpawn).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("win32: a taskkill 'error' event falls back to a direct kill", () => {
    let errCb: (() => void) | undefined;
    const killer = {
      once: vi.fn((ev: string, cb: () => void) => {
        if (ev === "error") errCb = cb;
      }),
    };
    const killSpawn = vi.fn(() => killer);
    const child = { pid: 4243, kill: vi.fn(() => true) };
    treeKill(child, "SIGTERM", {
      platform: "win32",
      killSpawn: killSpawn as unknown as typeof realSpawn,
    });
    // taskkill launched OK, so no direct kill yet…
    expect(child.kill).not.toHaveBeenCalled();
    // …until it reports it couldn't actually run.
    errCb?.();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("POSIX: a thrown group signal (ESRCH) is swallowed → direct kill", () => {
    const processKill = vi.fn(() => {
      const e = new Error("kill ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const child = { pid: 5555, kill: vi.fn(() => true) };
    treeKill(child, "SIGTERM", { platform: "linux", processKill });
    expect(processKill).toHaveBeenCalledWith(-5555, "SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("safeKill swallows a throwing child.kill (already-dead child)", () => {
    const child = {
      pid: 0,
      kill: vi.fn(() => {
        throw new Error("ESRCH");
      }),
    };
    expect(() =>
      treeKill(child, "SIGTERM", { platform: "linux", processKill: vi.fn() }),
    ).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("awaitExit — fast and late paths", () => {
  it("resolves immediately when exitCode is already set", async () => {
    const child = { exitCode: 0, once: vi.fn() };
    await expect(awaitExit(child, 1000)).resolves.toBeUndefined();
    expect(child.once).not.toHaveBeenCalled();
  });

  it("resolves once on a later exit and clears the timer (idempotent finish)", async () => {
    const ev = new EventEmitter();
    const child = {
      exitCode: null as number | null,
      once: ev.once.bind(ev) as never,
    };
    const p = awaitExit(child, 1000);
    ev.emit("exit", 143);
    ev.emit("exit", 143); // second emit must not double-resolve/throw
    await expect(p).resolves.toBeUndefined();
  });
});

describe("defaultProbePort", () => {
  it("returns true for a bindable ephemeral port", async () => {
    expect(await defaultProbePort(0)).toBe(true);
  });

  it("returns false when the port is already in use", async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const addr = srv.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      expect(await defaultProbePort(port)).toBe(false);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("returns false when listen throws synchronously (bad port)", async () => {
    expect(await defaultProbePort(999_999)).toBe(false);
  });
});

describe("buildReadyUrl", () => {
  it("builds a 127.0.0.1 URL for a normal path", () => {
    expect(buildReadyUrl(5173, "/health")?.toString()).toBe(
      "http://127.0.0.1:5173/health",
    );
  });

  it("strips a leading @/ so a smuggled authority stays on-host", () => {
    expect(buildReadyUrl(5173, "@evil.com/x")?.hostname).toBe("127.0.0.1");
  });

  it("returns null when the path resolves to a different host", () => {
    expect(buildReadyUrl(5173, "http://evil.com/")).toBeNull();
  });

  it("returns null when the path resolves to a different port", () => {
    expect(buildReadyUrl(5173, "http://127.0.0.1:9999/")).toBeNull();
  });

  it("returns null via catch when the base URL is malformed", () => {
    expect(buildReadyUrl(Number.NaN, "/")).toBeNull();
  });
});

describe("defaultProbeReady", () => {
  const signal = () => new AbortController().signal;

  it("returns false when buildReadyUrl rejects the path", async () => {
    expect(
      await defaultProbeReady({
        port: 5173,
        readyPath: "http://evil.com/",
        signal: signal(),
      }),
    ).toBe(false);
  });

  it("returns true when fetch resolves with any status", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ status: 404 })) as never;
    try {
      expect(
        await defaultProbeReady({ port: 5173, readyPath: "/", signal: signal() }),
      ).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("returns false when fetch throws (connection refused)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as never;
    try {
      expect(
        await defaultProbeReady({ port: 5173, readyPath: "/", signal: signal() }),
      ).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
