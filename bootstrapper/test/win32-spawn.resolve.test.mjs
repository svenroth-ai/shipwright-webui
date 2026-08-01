/*
 * win32-spawn — PATH/PATHEXT RESOLUTION, the ADR-044 security posture, and
 * ComSpec discovery. This is the half that touches the real filesystem and the
 * environment; the pure dispatch/quoting contract is in the sibling
 * `win32-spawn.test.mjs` (split by iterate-2026-08-01-win32-spawn-followups to
 * keep both under the 300-line limit).
 *
 * Real files are used wherever the code makes an fs decision — a mocked fs
 * would prove nothing about PATHEXT.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSpawn, win32ComSpec } from "../lib/win32-spawn.mjs";

const COMSPEC = "C:\\Windows\\System32\\cmd.exe";

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

  /*
   * These three asserted only `.toContain(...)` until
   * iterate-2026-08-01-win32-spawn-followups. That looseness was not a style
   * choice — it was the only way the assertions could pass on BOTH hosts, because
   * the fallback used the HOST `path.join` while `platform` was injected: on
   * Linux it produced `C:\Win/System32/cmd.exe`, mixed separators and all. With
   * the (a)-class calls pinned to `path.win32` the exact string is the same
   * everywhere, so pin the exact string. (Falsified: swapping the module back to
   * `path.posix.join` turns these RED.)
   */
  it("falls back to exactly <SystemRoot>\\System32\\cmd.exe", () => {
    expect(win32ComSpec({ ComSpec: "   ", SystemRoot: "C:\\Win" })).toBe("C:\\Win\\System32\\cmd.exe");
    expect(win32ComSpec({ SystemRoot: "C:\\Win" })).toBe("C:\\Win\\System32\\cmd.exe");
  });

  it("falls back to C:\\Windows when nothing is set", () => {
    expect(win32ComSpec({})).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("never emits a forward slash, on any host", () => {
    expect(win32ComSpec({ SystemRoot: "C:\\Win" })).not.toContain("/");
    expect(win32ComSpec({})).not.toContain("/");
  });
});
