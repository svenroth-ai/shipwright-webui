/*
 * preview-session-manager.validation.test.ts — D21 config-validation
 * hardening (audit findings F10 + F30).
 *
 * These are the AC2 regression tests: each is RED on pre-fix `main` (the
 * returned URL was raw string concatenation of an unsanitized ready_path, and
 * a missing dev_server.port silently defaulted to 0 and probed the dead port
 * for the full timeout) and green after the fix.
 *
 * Split out of preview-session-manager.test.ts because that file sits at its
 * bloat ceiling (grandfathered baseline). Same fakeChild shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

import {
  PreviewSessionManager,
  PreviewProfileInvalidError,
} from "./preview-session-manager.js";

function fakeChild(): unknown {
  const ev = new EventEmitter();
  const state = { exitCode: null as number | null, killed: false };
  return {
    emit: ev.emit.bind(ev),
    on: ev.on.bind(ev),
    once: ev.once.bind(ev),
    removeListener: ev.removeListener.bind(ev),
    kill: vi.fn((_sig?: NodeJS.Signals | number) => {
      state.killed = true;
      setImmediate(() => ev.emit("exit", 143));
      return true;
    }),
    stdin: null,
    stdout: null,
    stderr: null,
    pid: 12345,
    get exitCode() {
      return state.exitCode;
    },
    get killed() {
      return state.killed;
    },
  };
}

describe("PreviewSessionManager.spawn — returned-URL host pinning (F10)", () => {
  let mgr: PreviewSessionManager;

  beforeEach(() => {
    mgr = new PreviewSessionManager({ platform: "linux", processKill: () => {} });
  });

  function profileWith(readyPath: string) {
    return {
      dev_server: {
        command: "npm run dev",
        port: 5173,
        ready_path: readyPath,
        ready_timeout_seconds: 5,
      },
    };
  }

  async function spawnWith(readyPath: string) {
    const spawn = vi.fn(() => fakeChild());
    return mgr.spawn("p1", profileWith(readyPath), {
      cwd: "/tmp",
      spawn: spawn as unknown as never,
      probePort: async () => true,
      probeReady: async () => true,
      env: {},
    });
  }

  it("keeps a smuggled '@evil.com/' ready_path on-host (path, not authority)", async () => {
    // Pre-fix: `http://localhost:5173@evil.com/` → window.open lands on evil.com.
    const entry = await spawnWith("@evil.com/");
    expect(entry.url).toBe("http://localhost:5173/evil.com/");
    expect(new URL(entry.url).hostname).toBe("localhost");
  });

  it("normalizes a slash-less ready_path so the URL stays openable", async () => {
    // Pre-fix: `http://localhost:5173dashboard` — an unopenable URL.
    const entry = await spawnWith("dashboard");
    expect(entry.url).toBe("http://localhost:5173/dashboard");
  });

  it("rejects an absolute-URL ready_path, falling back to the bare origin", async () => {
    const entry = await spawnWith("http://evil.com/steal");
    expect(new URL(entry.url).hostname).toBe("localhost");
    expect(entry.url).toBe("http://localhost:5173");
  });

  it("still renders host-only for a root ready_path (no trailing slash)", async () => {
    const entry = await spawnWith("/");
    expect(entry.url).toBe("http://localhost:5173");
  });
});

describe("PreviewSessionManager.spawn — port validation (F30)", () => {
  let mgr: PreviewSessionManager;

  beforeEach(() => {
    mgr = new PreviewSessionManager({ platform: "linux", processKill: () => {} });
  });

  function opts(spawn: ReturnType<typeof vi.fn>) {
    return {
      cwd: "/tmp",
      spawn: spawn as unknown as never,
      probePort: async () => true,
      probeReady: async () => true,
      env: {},
    };
  }

  it("rejects a profile whose dev_server.port is missing — never spawns", async () => {
    // Pre-fix: port defaulted to 0, the port probe was skipped, and the
    // readiness probe hammered port 0 for the full timeout before killing the
    // healthy dev server and misreporting preview_timeout.
    const spawn = vi.fn(() => fakeChild());
    await expect(
      mgr.spawn(
        "p1",
        { dev_server: { command: "npm run dev", ready_timeout_seconds: 5 } },
        opts(spawn),
      ),
    ).rejects.toBeInstanceOf(PreviewProfileInvalidError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a zero / negative / non-integer / out-of-range port", async () => {
    const spawn = vi.fn(() => fakeChild());
    for (const port of [0, -1, 3000.5, 70000]) {
      await expect(
        mgr.spawn(
          "p1",
          {
            dev_server: {
              command: "npm run dev",
              port,
              ready_timeout_seconds: 5,
            },
          },
          opts(spawn),
        ),
      ).rejects.toBeInstanceOf(PreviewProfileInvalidError);
    }
    expect(spawn).not.toHaveBeenCalled();
  });
});
