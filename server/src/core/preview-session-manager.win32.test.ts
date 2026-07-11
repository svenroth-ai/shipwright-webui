/*
 * FROZEN GUARD — D03 (preview-win32-spawn). Author != fixer (MAX hardening).
 * Run-ID: iterate-2026-07-10-preview-win32-spawn.
 *
 * Committed FIRST and MUST-NOT-MODIFY: the fixer may not weaken these. They
 * cover audit findings F03 (HIGH) + F31 (LOW) in
 * server/src/core/preview-session-manager.ts.
 *
 * SEAM CONTRACT for the fixer (see iterate report): the win32/POSIX branch MUST
 * key off `process.platform` read AT CALL TIME inside `tokenizeCommand()` /
 * `spawn()` (default-param or in-body) — NOT cached at module load — so these
 * guards' `Object.defineProperty(process,'platform',…)` control reaches the
 * branch. `PreviewSpawnOptions.spawn` remains the injection seam; the injected
 * fake NEVER spawns a real process (calc/reboot/rm never run).
 *
 * Guard map:
 *   Guard 1  (permanent security fence, GREEN now)   — "Guard 1 — injection …".
 *   Guard 2a (RED anchor, F03) — "Guard 2a — F03 …".
 *   Guard 2b (RED anchor, F31) — "Guard 2b — F31 …".
 *   Guard 2c (POSIX regression pin, GREEN now) — "Guard 2c — POSIX pin …".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PreviewSessionManager } from "./preview-session-manager.js";

const REAL_PLATFORM = process.platform;
const ORIG_PATH = process.env.PATH;
const ORIG_PATHEXT = process.env.PATHEXT;
const tmpDirs: string[] = [];

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

// Plant a resolvable `<dir>\npm.cmd` on PATH so a BARE `npm` resolves
// deterministically on any CI OS (PATHEXT=".cmd" matches the lowercase file on a
// case-sensitive fs; post-fix an ABSENT bare command throws — see Guard 6).
function plantNpmOnPath(): void {
  const dir = mkdtempSync(path.join(tmpdir(), "d03-2a-"));
  tmpDirs.push(dir);
  writeFileSync(path.join(dir, "npm.cmd"), "@echo planted\r\n");
  process.env.PATH = dir;
  process.env.PATHEXT = ".cmd";
}

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: REAL_PLATFORM,
    configurable: true,
  });
  if (ORIG_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIG_PATH;
  if (ORIG_PATHEXT === undefined) delete process.env.PATHEXT;
  else process.env.PATHEXT = ORIG_PATHEXT;
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
  vi.restoreAllMocks();
});

// ChildProcess stub — never touches real child_process, so no injected payload
// can ever execute. Mirrors the bits PreviewSessionManager observes.
function fakeChild(): unknown {
  const ev = new EventEmitter();
  const state = { exitCode: null as number | null, killed: false };
  return {
    emit: ev.emit.bind(ev),
    on: ev.on.bind(ev),
    once: ev.once.bind(ev),
    removeListener: ev.removeListener.bind(ev),
    kill: vi.fn(() => {
      state.killed = true;
      setImmediate(() => ev.emit("exit", 143));
      return true;
    }),
    stdin: null,
    stdout: null,
    stderr: null,
    pid: 4242,
    get exitCode() {
      return state.exitCode;
    },
    get killed() {
      return state.killed;
    },
  };
}

function profile(command: string) {
  return {
    dev_server: {
      command,
      port: 5173,
      ready_path: "/",
      ready_timeout_seconds: 5,
    },
  };
}

type SpawnCall = [string, string[], { shell?: unknown; cwd?: string }];

// Drive a real mgr.spawn() through the injected spawn seam under a stubbed
// platform, capturing the (command, argv, options) the manager would spawn.
async function capture(command: string, platform: NodeJS.Platform) {
  setPlatform(platform);
  const spawn = vi.fn((_c: string, _a: string[], _o: unknown) => fakeChild());
  const mgr = new PreviewSessionManager();
  let rejected: unknown = null;
  try {
    await mgr.spawn("p1", profile(command), {
      cwd: platform === "win32" ? "C:\\proj" : "/proj",
      spawn: spawn as unknown as never,
      probePort: async () => true,
      probeReady: async () => true,
      env: {},
    });
  } catch (e) {
    rejected = e;
  }
  return { spawn, rejected };
}

describe("D03 Guard 2a — F03 win32 npm spawn (RED anchor)", () => {
  it("wraps 'npm run dev' in cmd.exe /d /s /c with discrete argv, shell:false", async () => {
    plantNpmOnPath();
    const { spawn } = await capture("npm run dev", "win32");
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as unknown as SpawnCall;
    expect(options.shell).toBeFalsy();
    // argv0 must be the cmd.exe shim — NOT bare 'npm' (npm is npm.cmd on win32,
    // which CVE-2024-27980 EINVAL-blocks / ENOENTs under shell:false).
    expect(command.toLowerCase()).toMatch(/(^|[\\/])cmd\.exe$/);
    expect(args.slice(0, 3).map((a) => a.toLowerCase())).toEqual([
      "/d",
      "/s",
      "/c",
    ]);
    const rest = args.slice(3);
    expect(rest[0].toLowerCase()).toMatch(/(^|[\\/])npm(\.cmd)?$/);
    expect(rest.slice(1)).toEqual(["run", "dev"]);
  });
});

describe("D03 Guard 2b — F31 win32 backslash preservation (RED anchor)", () => {
  it("spawn keeps 'C:\\tools\\node.exe' backslashes (not 'C:toolsnode.exe')", async () => {
    const { spawn } = await capture("C:\\tools\\node.exe server.js", "win32");
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as unknown as SpawnCall;
    expect(options.shell).toBeFalsy();
    const all = [command, ...args];
    expect(all).toContain("C:\\tools\\node.exe");
    expect(all).not.toContain("C:toolsnode.exe");
    expect(all).toContain("server.js");
  });

  it("tokenizeCommand keeps backslashes on win32", () => {
    setPlatform("win32");
    const argv = PreviewSessionManager.tokenizeCommand(
      "C:\\tools\\node.exe server.js",
    );
    expect(argv).toContain("C:\\tools\\node.exe");
    expect(argv).not.toContain("C:toolsnode.exe");
    expect(argv).toContain("server.js");
  });
});

describe("D03 Guard 2c — POSIX pin (GREEN now; fix must not touch POSIX)", () => {
  for (const platform of ["linux", "darwin"] as const) {
    it(`tokenizeCommand byte-identical on ${platform}`, () => {
      setPlatform(platform);
      expect(PreviewSessionManager.tokenizeCommand("npm run dev")).toEqual([
        "npm",
        "run",
        "dev",
      ]);
      expect(PreviewSessionManager.tokenizeCommand('foo "bar baz"')).toEqual([
        "foo",
        "bar baz",
      ]);
      // POSIX backslash-escape IS correct on POSIX — the fix must not change it.
      expect(
        PreviewSessionManager.tokenizeCommand("C:\\tools\\node.exe server.js"),
      ).toEqual(["C:toolsnode.exe", "server.js"]);
    });
  }

  it("spawn shape byte-identical on linux (npm, [run,dev], shell:false)", async () => {
    const { spawn } = await capture("npm run dev", "linux");
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as unknown as SpawnCall;
    expect(command).toBe("npm");
    expect(args).toEqual(["run", "dev"]);
    expect(options.shell).toBe(false);
  });
});

// Payloads that would be catastrophic if ever shell-interpreted. The fence is
// a DISJUNCTION: either the manager refuses (throws, never spawns) OR it spawns
// a discrete, non-interpolated, shell-less argv. Both are safe; only shell:true
// or a single joined command string fails it.
const INJECTION = [
  "npm run dev & calc.exe",
  "npm run dev; rm -rf /",
  "npm run dev `reboot`",
  "npm run dev $(reboot)",
  "npm run dev | whoami",
];
const BARE_OPS = new Set(["&", "&&", "|", "||", ";", "`"]);

describe("D03 Guard 1 — injection security fence (permanent; GREEN now)", () => {
  for (const platform of ["win32", "linux"] as const) {
    for (const cmd of INJECTION) {
      it(`${platform}: never shell-executes ${JSON.stringify(cmd)}`, async () => {
        const { spawn, rejected } = await capture(cmd, platform);
        if (rejected) {
          // Refused before spawn — nothing executed. Safe.
          expect(spawn).not.toHaveBeenCalled();
          return;
        }
        // Spawned → MUST be discrete, non-interpolated, shell-less.
        expect(spawn).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawn.mock
          .calls[0] as unknown as SpawnCall;
        expect(options.shell).toBeFalsy();
        const all = [command, ...args].map(String);
        for (const el of all) {
          // (1) no single arg fuses the whole command (`/c "<joined>"` regression)
          expect(el.includes(cmd)).toBe(false);
          // (2) no arg carries a whitespace-fused shell operator or $(...)
          expect(el).not.toMatch(/\s[&|;`]|\$\(/);
          // (3) no arg is a bare shell separator token
          expect(BARE_OPS.has(el)).toBe(false);
        }
      });
    }
  }
});
