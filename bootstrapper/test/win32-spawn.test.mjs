/*
 * win32-spawn — the DISPATCH contract: given an argv, what command line comes
 * out. Pure string work; no filesystem, no PATH.
 *
 * `resolveSpawn` takes injected `platform` + `env`, so the win32 branch is
 * exercised on Linux CI too. Its fs-touching half (PATH/PATHEXT resolution, the
 * security posture, win32ComSpec) lives in the sibling
 * `win32-spawn.resolve.test.mjs` — split on that seam by
 * iterate-2026-08-01-win32-spawn-followups to keep both files under the
 * 300-line limit.
 *
 * What these CANNOT prove is that the resulting argv actually starts a process
 * on Windows; that is process startup, and it is verified by real execution
 * (iterate-2026-07-31-win32-shell-spawn-remediation AC-6).
 */

import { describe, it, expect } from "vitest";

import { resolveSpawn } from "../lib/win32-spawn.mjs";

const COMSPEC = "C:\\Windows\\System32\\cmd.exe";
/** win32 opts with a PATH that resolves nothing. */
const WIN = { platform: "win32", env: { ComSpec: COMSPEC, PATHEXT: ".COM;.EXE;.BAT;.CMD", PATH: "" } };

describe("fixture integrity", () => {
  /*
   * Non-circular, and earned twice. Almost every assertion in this file
   * compares a resolver result against COMSPEC, so if COMSPEC itself loses a
   * backslash level both sides are mangled identically and the suite passes
   * while proving nothing. PR #340 recorded exactly that ("eaten backslashes
   * in a heredoc-appended test, which made four assertions compare two
   * identically mangled strings"), and it recurred while splitting this file
   * in iterate-2026-08-01-win32-spawn-followups — caught by oxlint's
   * no-useless-escape, not by the 155 green tests.
   *
   * Built from a char code so this check cannot itself be escape-mangled.
   */
  it("COMSPEC really contains three separators, not eaten escapes", () => {
    const BACKSLASH = String.fromCharCode(92);
    expect(COMSPEC.split(BACKSLASH)).toHaveLength(4);
    expect(COMSPEC.endsWith(`${BACKSLASH}cmd.exe`)).toBe(true);
  });
});

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

describe("resolveSpawn — extensions are classified by WIN32 rules, not host rules", () => {
  /*
   * `x\.exe` is the one input where the flavours disagree, and therefore the
   * only BEHAVIOURAL pin on the (a)-class `extname` calls. Stage-3 doubt review
   * showed that without it the extname half of the `path.win32` flavouring was
   * unobservable — every other argv in this suite returns the same string under
   * host, posix and win32 `extname`, so `path.extname` could be restored and
   * the whole suite would stay green.
   *
   * win32: basename is `.exe` (split on the backslash) -> a dotfile -> ext ""
   * -> not an executable -> PATH lookup fails -> path-like -> cmd.exe wrap.
   * posix: one segment ending `.exe` -> EXECUTABLE -> spawned directly.
   */
  it("a leading-dot basename is NOT treated as an executable", () => {
    const r = resolveSpawn(["x\\.exe"], WIN);
    expect(r.command).toBe(COMSPEC);
    expect(r.command).not.toBe("x\\.exe");
    expect(r.args).toEqual(["/d", "/s", "/c", "x\\.exe"]);
  });
});
