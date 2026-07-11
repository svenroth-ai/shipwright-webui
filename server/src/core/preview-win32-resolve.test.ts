/*
 * FROZEN GUARD — D03 (preview-win32-spawn), security-review rounds 2-3.
 * Author != fixer. Run-ID: iterate-2026-07-10-preview-win32-spawn.
 *
 * Committed alongside the fix; MUST-NOT-MODIFY by the fixer. Cohesive to
 * preview-win32-spawn.ts executable resolution. Guard 6 is RED on 0789af0 and
 * GREEN after remediation; Guards 3-5 are regression pins (GREEN on 0789af0).
 *
 * Cross-OS determinism: CI runs server vitest on ubuntu (case-SENSITIVE fs), and
 * resolveSpawn's win32 branch is only reached when process.platform is stubbed —
 * so these tests must run AND pass on Linux to cover it. They therefore set
 * PATHEXT=".cmd" (matches the lowercase planted shims EXACTLY, so realpathSync
 * resolves on a case-sensitive fs too) and use forward-slash path-like inputs.
 * Real files live only under os.tmpdir().
 *
 *   Guard 3 (HIGH, GREEN) — a BARE command resolves via PATH, never the
 *     untrusted previewed-project cwd; a path-like command stays cwd-relative.
 *   Guard 4 (HIGH, GREEN) — a spaced .cmd shim path is emitted as the canonical
 *     verbatim `cmd /d /s /c ""<quoted-shim>" <args>"` line (exact argv pinned).
 *   Guard 5 (MEDIUM, GREEN) — win32 refuses a `%…%` command.
 *   Guard 6 (HIGH, RED anchor) — a BARE command ABSENT from PATH must THROW,
 *     never fall through to `cmd /d /s /c <bare>` (cmd resolves cwd-first → a
 *     planted <cwd>\npm.cmd in an untrusted repo would execute).
 *
 * Isolation: Guards 3/6 exercise the exported resolveSpawn() (pure resolution —
 * no spawn). Guards 4/5 drive mgr.spawn() through the injected fake-spawn seam,
 * so NOTHING ever executes.
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

// Plant a real file (never executed) and return its canonical realpath. Lower-
// case `.cmd` + PATHEXT=".cmd" → the lookup matches on a case-sensitive fs too.
function plant(dir: string, rel: string): string {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "@echo planted\r\n");
  return realpathSync.native(full);
}

function usePathExt(): void {
  process.env.PATHEXT = ".cmd";
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

describe("D03 Guard 3 — bare resolves via PATH, not cwd (regression pin, HIGH)", () => {
  it("resolves a BARE command via PATH, never the untrusted cwd", () => {
    setPlatform("win32");
    const cwd = tmp();
    const pathDir = tmp();
    const cwdShim = plant(cwd, "npm.cmd"); // hijack bait in the previewed repo
    const pathShim = plant(pathDir, "npm.cmd"); // legit, on PATH
    process.env.PATH = pathDir;
    usePathExt();

    const { args } = resolveSpawn(["npm", "run", "dev"], cwd);
    expect(args[3]).toBe(pathShim);
    expect(args[3]).not.toBe(cwdShim);
  });

  it("still resolves a path-like command cwd-relative (fix must not over-reach)", () => {
    setPlatform("win32");
    const cwd = tmp();
    const localShim = plant(cwd, "localdev.cmd");
    process.env.PATH = tmp(); // empty dir on PATH — cannot satisfy the resolve
    usePathExt();

    const { args } = resolveSpawn(["./localdev", "run"], cwd);
    expect(args[3]).toBe(localShim);
  });
});

describe("D03 Guard 4 — spaced .cmd shim quoting (regression pin, HIGH)", () => {
  it("emits the canonical verbatim outer-quoted cmd.exe line for a spaced shim", async () => {
    const cwd = tmp(); // empty previewed-project dir
    const shim = plant(tmp(), path.join("Program Files", "nodejs", "npm.cmd"));
    expect(shim).toContain(" "); // sanity: the resolved shim path has a space
    process.env.PATH = path.dirname(shim);
    usePathExt();

    const { spawn } = await capture("npm run dev", "win32", cwd);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock
      .calls[0] as unknown as SpawnCall;
    expect(options.shell).toBeFalsy();
    // Verbatim mode → the EXACT argv is load-bearing; pin it directly (no join).
    expect(options.windowsVerbatimArguments).toBe(true);
    expect(String(command).toLowerCase()).toMatch(/(?:^|[\\/])cmd\.exe$/);
    expect(args).toHaveLength(4);
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // canonical `cmd /d /s /c ""<quoted-shim>" run dev"` — outer pair strips
    // under /s, leaving the inner shim-path quotes intact.
    expect(args[3]).toBe(`""${shim}" run dev"`);
  });
});

describe("D03 Guard 5 — win32 refuses '%' var-expansion (regression pin, MEDIUM)", () => {
  for (const cmd of ["%COMSPEC% run dev", "npm run %CD%"]) {
    it(`refuses ${JSON.stringify(cmd)} on win32 (never spawns)`, async () => {
      const { spawn, rejected } = await capture(cmd, "win32", "C:\\proj");
      expect(spawn).not.toHaveBeenCalled();
      expect(rejected).toBeInstanceOf(PreviewProfileInvalidError);
    });
  }
});

describe("D03 Guard 6 — bare-absent must throw, not cmd-delegate (RED anchor, HIGH)", () => {
  it("throws for a BARE command absent from PATH (no cwd-first cmd delegation)", () => {
    setPlatform("win32");
    const cwd = tmp();
    plant(cwd, "npm.cmd"); // hijack bait: cmd would resolve <cwd>\npm.cmd first
    process.env.PATH = tmp(); // empty dir → bare `npm` is NOT on PATH
    usePathExt();
    // Must refuse (throw), NOT fall through to `cmd /d /s /c npm run dev`.
    expect(() => resolveSpawn(["npm", "run", "dev"], cwd)).toThrow();
  });

  it("a bare command that IS on PATH still resolves (green companion)", () => {
    setPlatform("win32");
    const pathShim = plant(tmp(), "npm.cmd");
    process.env.PATH = path.dirname(pathShim);
    usePathExt();
    const { args } = resolveSpawn(["npm", "run", "dev"], tmp());
    expect(args[3]).toBe(pathShim);
  });

  it("a path-like absent command still wraps as today (no throw)", () => {
    setPlatform("win32");
    process.env.PATH = tmp();
    usePathExt();
    const ghost = "C:\\tools\\ghostserver";
    const { command, args } = resolveSpawn([ghost, "run"], tmp());
    expect(String(command).toLowerCase()).toMatch(/(?:^|[\\/])cmd\.exe$/);
    expect(args).toEqual(["/d", "/s", "/c", ghost, "run"]);
  });
});
