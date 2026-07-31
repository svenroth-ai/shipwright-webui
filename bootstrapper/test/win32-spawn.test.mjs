/*
 * win32-spawn — the shell-free replacement for `shell: true` on Windows.
 *
 * These pin the CONTRACT (what argv comes out). They are deliberately
 * host-agnostic: `resolveSpawn` takes injected `platform` + `env`, so the win32
 * branch is exercised on Linux CI too. Real files are used wherever the code
 * makes an fs decision — a mocked fs would prove nothing about PATHEXT.
 *
 * What they CANNOT prove is that the resulting argv actually starts a process on
 * Windows; that is process startup, and it is verified by real execution
 * (iterate-2026-07-31-win32-shell-spawn-remediation AC-6).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSpawn, win32ComSpec } from "../lib/win32-spawn.mjs";

const COMSPEC = "C:\\Windows\\System32\\cmd.exe";
/** win32 opts with a PATH that resolves nothing, unless a test overrides it. */
const WIN = { platform: "win32", env: { ComSpec: COMSPEC, PATHEXT: ".COM;.EXE;.BAT;.CMD", PATH: "" } };

let tmp;
let dirA;
let dirB;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sw-win32-spawn-"));
  dirA = path.join(tmp, "a");
  dirB = path.join(tmp, "b");
  mkdirSync(dirA);
  mkdirSync(dirB);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function winEnv(pathDirs, extra = {}) {
  return {
    platform: "win32",
    env: { ComSpec: COMSPEC, PATHEXT: ".COM;.EXE;.BAT;.CMD", PATH: pathDirs.join(";"), ...extra },
  };
}

describe("resolveSpawn — POSIX is a pass-through", () => {
  it("hands back argv0 + rest untouched, never cmd.exe", () => {
    const r = resolveSpawn(["claude", "--version"], { platform: "linux", env: {} });
    expect(r).toEqual({ command: "claude", args: ["--version"] });
  });

  it("darwin behaves the same", () => {
    const r = resolveSpawn(["uv", "--version"], { platform: "darwin", env: {} });
    expect(r).toEqual({ command: "uv", args: ["--version"] });
  });
});

describe("resolveSpawn — win32 executables spawn directly (no shell, no cmd.exe)", () => {
  it("an explicit .exe path is spawned as-is", () => {
    const r = resolveSpawn(["C:\\Users\\x\\.local\\bin\\claude.exe", "--version"], WIN);
    expect(r).toEqual({ command: "C:\\Users\\x\\.local\\bin\\claude.exe", args: ["--version"] });
  });

  it("backslashes survive verbatim — never treated as escapes (audit F31)", () => {
    const r = resolveSpawn(["C:\\tools\\node.exe", "-e", "1"], WIN);
    expect(r.command).toBe("C:\\tools\\node.exe");
  });

  it(".com counts as an executable too", () => {
    const r = resolveSpawn(["C:\\tools\\thing.com"], WIN);
    expect(r).toEqual({ command: "C:\\tools\\thing.com", args: [] });
  });
});

describe("resolveSpawn — win32 .cmd/.bat shims go through cmd.exe with DISCRETE argv", () => {
  it("wraps an explicit .cmd path in `cmd /d /s /c`", () => {
    const r = resolveSpawn(["C:\\npm\\claude.cmd", "plugin", "list"], WIN);
    expect(r).toEqual({
      command: COMSPEC,
      args: ["/d", "/s", "/c", "C:\\npm\\claude.cmd", "plugin", "list"],
    });
    expect(r.windowsVerbatimArguments).toBeUndefined();
  });

  it("wraps .bat the same way", () => {
    const r = resolveSpawn(["C:\\tools\\thing.bat"], WIN);
    expect(r.args).toEqual(["/d", "/s", "/c", "C:\\tools\\thing.bat"]);
  });

  it("never sets a `shell` option on any branch", () => {
    for (const argv of [["C:\\npm\\x.cmd"], ["C:\\bin\\x.exe"], ["C:\\a b\\x.cmd"]]) {
      expect(resolveSpawn(argv, WIN)).not.toHaveProperty("shell");
    }
  });
});

describe("resolveSpawn — a SPACED path takes the verbatim outer-quoted form", () => {
  it("emits the canonical outer-quoted line + windowsVerbatimArguments", () => {
    const r = resolveSpawn(["C:\\Program Files\\nodejs\\npm.cmd", "--version"], WIN);
    expect(r.command).toBe(COMSPEC);
    expect(r.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // `/s` strips ONLY the outer quote pair, leaving the shim-path quotes intact.
    expect(r.args[3]).toBe('""C:\\Program Files\\nodejs\\npm.cmd" --version"');
    expect(r.args).toHaveLength(4);
    expect(r.windowsVerbatimArguments).toBe(true);
  });

  it("quotes a spaced ARGUMENT as well as a spaced target", () => {
    const r = resolveSpawn(["C:\\npm\\claude.cmd", "--name", "my task"], WIN);
    expect(r.args[3]).toBe('"C:\\npm\\claude.cmd --name "my task""');
    expect(r.windowsVerbatimArguments).toBe(true);
  });

  it("an empty-string argument is quoted, not dropped", () => {
    const r = resolveSpawn(["C:\\npm\\x.cmd", "", "tail"], WIN);
    expect(r.args[3]).toBe('"C:\\npm\\x.cmd "" tail"');
  });
});

describe("resolveSpawn — bare names resolve from PATH via PATHEXT", () => {
  it("a bare name resolving to an .exe is spawned directly", () => {
    const exe = path.join(dirA, "toolexe.EXE");
    writeFileSync(exe, "");
    const r = resolveSpawn(["toolexe", "--version"], winEnv([dirA]));
    expect(r.args).toEqual(["--version"]);
    expect(r.command.toLowerCase()).toBe(exe.toLowerCase());
  });

  it("a bare name resolving to a .cmd is wrapped in cmd.exe", () => {
    const cmdFile = path.join(dirA, "toolcmd.CMD");
    writeFileSync(cmdFile, "");
    const r = resolveSpawn(["toolcmd", "plugin", "list"], winEnv([dirA]));
    expect(r.command).toBe(COMSPEC);
    expect(r.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(r.args[3].toLowerCase()).toBe(cmdFile.toLowerCase());
    expect(r.args.slice(4)).toEqual(["plugin", "list"]);
  });

  it("PATHEXT order decides: .EXE wins over a same-named .CMD in the same dir", () => {
    writeFileSync(path.join(dirB, "dual.EXE"), "");
    writeFileSync(path.join(dirB, "dual.CMD"), "");
    const r = resolveSpawn(["dual"], winEnv([dirB]));
    expect(r.command.toLowerCase().endsWith(".exe")).toBe(true);
  });

  it("earlier PATH entries win over later ones", () => {
    writeFileSync(path.join(dirA, "dupe.EXE"), "");
    writeFileSync(path.join(dirB, "dupe.EXE"), "");
    const r = resolveSpawn(["dupe"], winEnv([dirA, dirB]));
    expect(r.command.toLowerCase()).toBe(path.join(dirA, "dupe.EXE").toLowerCase());
  });

  it("reads `Path` when the env uses that casing instead of `PATH`", () => {
    writeFileSync(path.join(dirA, "cased.EXE"), "");
    const r = resolveSpawn(["cased"], {
      platform: "win32",
      env: { ComSpec: COMSPEC, PATHEXT: ".EXE", Path: dirA },
    });
    expect(r.command.toLowerCase()).toBe(path.join(dirA, "cased.EXE").toLowerCase());
  });
});

describe("resolveSpawn — an UNUSABLE candidate does not abort the scan", () => {
  /*
   * The real-world case is the Microsoft Store App-Execution-Alias: verified
   * 2026-07-31 on Windows 11, `realpathSync.native` on
   * `…\WindowsApps\python3.EXE` throws EACCES (NOT ENOENT). If that aborted the
   * search, a machine with a perfectly good `python` later on PATH would be
   * reported as having no Python at all. A directory standing where the
   * executable should be reproduces the same "candidate exists but is unusable"
   * shape portably.
   */
  it("skips a directory named like the executable and keeps scanning PATH", () => {
    mkdirSync(path.join(dirA, "shadow.EXE"));
    const real = path.join(dirB, "shadow.EXE");
    writeFileSync(real, "");
    const r = resolveSpawn(["shadow"], winEnv([dirA, dirB]));
    expect(r.command.toLowerCase()).toBe(real.toLowerCase());
  });
});

describe("resolveSpawn — security posture inherited from ADR-044", () => {
  it("an unresolvable BARE name goes to CreateProcess, never to `cmd /c <bare>`", () => {
    /*
     * Delegating a bare name to cmd.exe would hand it cmd's OWN cwd-first
     * lookup, which a planted `.\claude.cmd` wins. A direct bare spawn is
     * PATH-only instead — verified on Windows 11: a planted `.\x.exe` returns
     * ENOENT even with cwd set to its own directory. This fallback is what keeps
     * an App-Execution-Alias (Store Python) reachable, since realpath cannot
     * follow one. See divergence 5 in the module header.
     */
    const r = resolveSpawn(["definitely-not-installed", "--version"], winEnv([dirA]));
    expect(r).toEqual({ command: "definitely-not-installed", args: ["--version"] });
    expect(r.command.toLowerCase()).not.toContain("cmd.exe");
  });

  it("a bare name is NOT resolved from the current directory", () => {
    // `planted.CMD` exists in cwd but cwd is not on PATH → must not be found.
    const cwd = process.cwd();
    const planted = path.join(cwd, "planted-by-test.CMD");
    writeFileSync(planted, "");
    try {
      const r = resolveSpawn(["planted-by-test"], winEnv([dirA]));
      // Falls through to the bare name — crucially NOT to the planted cwd file
      // and NOT through cmd.exe.
      expect(r.command).toBe("planted-by-test");
      expect(r.args).toEqual([]);
    } finally {
      rmSync(planted, { force: true });
    }
  });

  it("a bare name that ALREADY carries a shim extension skips resolution (known narrow gap)", () => {
    /*
     * `npm.cmd` has a .cmd extension, so it never reaches resolveViaPathExt and
     * is wrapped as given — which DOES reach cmd.exe's cwd-first lookup. No
     * caller in this package does that (all three pass extension-less names or
     * absolute paths), and the module header says so in as many words. Pinned
     * here so the gap cannot silently widen or be forgotten.
     */
    const r = resolveSpawn(["npm.cmd", "i"], winEnv([dirA]));
    expect(r.command).toBe(COMSPEC);
    expect(r.args).toEqual(["/d", "/s", "/c", "npm.cmd", "i"]);
  });

  it("a PATH-LIKE name is the caller's explicit target and still wraps", () => {
    const r = resolveSpawn([".\\local.cmd"], winEnv([dirA]));
    expect(r.command).toBe(COMSPEC);
    expect(r.args).toEqual(["/d", "/s", "/c", ".\\local.cmd"]);
  });
});

describe("win32ComSpec", () => {
  it("prefers ComSpec from the environment", () => {
    expect(win32ComSpec({ ComSpec: "D:\\alt\\cmd.exe" })).toBe("D:\\alt\\cmd.exe");
  });

  it("accepts the COMSPEC casing", () => {
    expect(win32ComSpec({ COMSPEC: "D:\\alt\\cmd.exe" })).toBe("D:\\alt\\cmd.exe");
  });

  it("falls back to SystemRoot when ComSpec is absent or blank", () => {
    expect(win32ComSpec({ ComSpec: "   ", SystemRoot: "C:\\Win" })).toContain("cmd.exe");
    expect(win32ComSpec({ SystemRoot: "C:\\Win" })).toContain("Win");
  });

  it("falls back to C:\\Windows when nothing is set", () => {
    expect(win32ComSpec({})).toContain("cmd.exe");
  });
});

describe("resolveSpawn — cmd METACHARACTERS are quoted, never handed to cmd.exe raw", () => {
  /*
   * Found by external code review on iterate-2026-07-31. A token carrying a
   * metacharacter but NO whitespace used to take the discrete-argv branch, where
   * cmd.exe parses it: a PATH directory such as `C:\tools&more\` would split
   * `…\tools&more\claude.cmd` into two commands. Quoting makes them literal.
   * Divergence 5 from the server original, which leans on an upstream blocklist
   * fence this package does not have.
   */
  it.each(["&", "|", "<", ">", "^"])("a target containing %s is quoted, not left bare", (ch) => {
    const target = `C:\\tools${ch}more\\tool.cmd`;
    const r = resolveSpawn([target], WIN);
    expect(r.windowsVerbatimArguments).toBe(true);
    expect(r.args[3]).toBe(`""${target}""`);
    // The bare metacharacter must never appear as its own argv entry.
    expect(r.args).not.toContain(target);
  });

  it.each(["a&b", "a|b", "a<b", "a>b", "a^b"])(
    "an ARGUMENT containing a metacharacter (%s) is quoted too",
    (arg) => {
      const r = resolveSpawn(["C:\\npm\\x.cmd", arg], WIN);
      expect(r.windowsVerbatimArguments).toBe(true);
      expect(r.args[3]).toContain(`"${arg}"`);
      expect(r.args).not.toContain(arg);
    },
  );

  it("an ordinary token is still discrete argv — no needless quoting", () => {
    const r = resolveSpawn(["C:\\npm\\x.cmd", "plugin", "list"], WIN);
    expect(r.windowsVerbatimArguments).toBeUndefined();
    expect(r.args).toEqual(["/d", "/s", "/c", "C:\\npm\\x.cmd", "plugin", "list"]);
  });
});
