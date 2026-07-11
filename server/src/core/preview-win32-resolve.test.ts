/*
 * FROZEN GUARD — D03 (preview-win32-spawn), security-review round 2.
 * Author != fixer. Run-ID: iterate-2026-07-10-preview-win32-spawn.
 *
 * Committed AFTER the first fix (e931d25); MUST-NOT-MODIFY by the fixer. Each
 * anchor is RED on e931d25 and GREEN after remediation. Split out of
 * preview-session-manager.win32.test.ts (which is at 216 LOC — adding here would
 * exceed the 300-LOC ceiling); cohesive to preview-win32-spawn.ts resolution.
 *
 *   Guard 3 (HIGH)   — cwd-before-PATH hijack: a BARE command must resolve via
 *     PATH, never the untrusted previewed-project cwd. Path-like commands must
 *     stay cwd-relative (fix must not over-reach).
 *   Guard 4 (HIGH)   — a spaced `.cmd` shim path must stay QUOTED
 *     (windowsVerbatimArguments + an outer-quote wrap) so cmd.exe /s does not
 *     strip the quotes off `C:\Program Files\…` (breaks spawn + re-opens the
 *     unquoted-search-path hole).
 *   Guard 5 (MEDIUM) — win32 must REFUSE a `%…%` command (cmd var-expansion),
 *     like the other shell metacharacters.
 *
 * Isolation: Guard 3 exercises the exported resolveSpawn() (pure resolution — no
 * spawn at all). Guards 4/5 drive mgr.spawn() through the injected fake-spawn
 * seam, so NOTHING ever executes. Real files are planted only under os.tmpdir().
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PreviewSessionManager,
  PreviewProfileInvalidError,
} from "./preview-session-manager.js";
import { resolveSpawn } from "./preview-win32-spawn.js";

const REAL_PLATFORM = process.platform;
const ORIG_PATH = process.env.PATH;
const ORIG_PATHEXT = process.env.PATHEXT;
const tmpDirs: string[] = [];

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "d03-"));
  tmpDirs.push(d);
  return d;
}

// Plant a real file (never executed) and return its canonical realpath.
function plant(dir: string, rel: string): string {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "@echo planted\r\n");
  return realpathSync.native(full);
}

afterEach(() => {
  setPlatform(REAL_PLATFORM);
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

// ChildProcess stub — never touches real child_process, so nothing executes.
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

type SpawnCall = [
  string,
  string[],
  { shell?: unknown; cwd?: string; windowsVerbatimArguments?: unknown },
];

async function capture(command: string, platform: NodeJS.Platform, cwd: string) {
  setPlatform(platform);
  const spawn = vi.fn((_c: string, _a: string[], _o: unknown) => fakeChild());
  const mgr = new PreviewSessionManager();
  let rejected: unknown = null;
  try {
    await mgr.spawn("p1", profile(command), {
      cwd,
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

describe("D03 Guard 3 — cwd-before-PATH hijack (RED anchor, HIGH)", () => {
  it("resolves a BARE command via PATH, not the untrusted cwd", () => {
    setPlatform("win32");
    const cwd = tmp();
    const pathDir = tmp();
    const cwdShim = plant(cwd, "npm.cmd"); // malicious, planted in project dir
    const pathShim = plant(pathDir, "npm.cmd"); // legit, on PATH
    process.env.PATH = pathDir;
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

    const { args } = resolveSpawn(["npm", "run", "dev"], cwd);
    // cmd.exe wrap → args = ["/d","/s","/c", <shim>, "run", "dev"]
    const target = args[3];
    expect(target).toBe(pathShim);
    expect(target).not.toBe(cwdShim);
  });

  it("still resolves a path-like command cwd-relative (fix must not over-reach)", () => {
    setPlatform("win32");
    const cwd = tmp();
    const localShim = plant(cwd, "localdev.cmd");
    process.env.PATH = tmp(); // empty dir on PATH — cannot satisfy the resolve
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

    const { args } = resolveSpawn([".\\localdev", "run"], cwd);
    expect(args[3]).toBe(localShim);
  });
});

describe("D03 Guard 4 — spaced .cmd shim quoting (RED anchor, HIGH)", () => {
  it("quotes a spaced shim path + sets windowsVerbatimArguments for cmd /s", async () => {
    const cwd = tmp(); // empty previewed-project dir
    const base = tmp();
    const shim = plant(base, path.join("Program Files", "nodejs", "npm.cmd"));
    expect(shim).toContain(" "); // sanity: the resolved shim path has a space
    process.env.PATH = path.dirname(shim);
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

    const { spawn } = await capture("npm run dev", "win32", cwd);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock
      .calls[0] as unknown as SpawnCall;
    expect(options.shell).toBeFalsy();
    // Node must NOT auto-quote (cmd /s then strips it) — verbatim + our quoting.
    expect(options.windowsVerbatimArguments).toBe(true);
    const line = [command, ...args].join(" ");
    // spaced shim path survives, wrapped in its own quotes …
    expect(line).toContain(`"${shim}"`);
    // … inside an OUTER quote pair (canonical `cmd /d /s /c ""<quoted>" args"`) …
    expect(line).toMatch(/\/c\s+""/);
    // … with the args tail intact.
    expect(line).toMatch(/npm\.cmd" run dev/i);
  });
});

describe("D03 Guard 5 — win32 refuses '%' var-expansion (RED anchor, MEDIUM)", () => {
  for (const cmd of ["%COMSPEC% run dev", "npm run %CD%"]) {
    it(`refuses ${JSON.stringify(cmd)} on win32 (never spawns)`, async () => {
      const { spawn, rejected } = await capture(cmd, "win32", "C:\\proj");
      expect(spawn).not.toHaveBeenCalled();
      expect(rejected).toBeInstanceOf(PreviewProfileInvalidError);
    });
  }
});
