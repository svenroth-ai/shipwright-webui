/*
 * claude-cli — the OS-touching seam that runs the real `claude` plugin CLI.
 *
 * `plugins.mjs` is tested everywhere else through an injected `runClaude`, so
 * `defaultRunClaude` itself had no coverage. These pin the two properties that
 * survive without a `claude` on the machine: the argument charset gate, and the
 * refusal to reach cmd.exe's cwd-first lookup when the binary is unresolvable
 * (iterate-2026-07-31-win32-shell-spawn-remediation).
 */

import { describe, it, expect } from "vitest";

import { defaultRunClaude, SAFE_ARG } from "../lib/claude-cli.mjs";

describe("defaultRunClaude — the SAFE_ARG charset gate stays load-bearing", () => {
  /*
   * The gate predates the shell:true removal and is NOT made redundant by it: a
   * `.cmd` target is still ultimately parsed by cmd.exe, and Node quotes an
   * argument for spaces — not for `&`, `|`, `^` or `%`. Removing it as
   * "obviously unnecessary now" is precisely the Chesterton fence to leave up.
   */
  const HOSTILE = ["a&b", "a|b", "a>b", "a%PATH%b", "a b", "a^b", "a;b", "$(x)", "`x`"];

  it.each(HOSTILE)("refuses %s WITHOUT spawning anything", (arg) => {
    const r = defaultRunClaude(["plugin", "list", arg]);
    expect(r.ok).toBe(false);
    expect(r.code).toBeNull();
    expect(r.stderr).toContain("refused unsafe claude arg");
  });

  it("still ACCEPTS every argument shape the installer actually uses", () => {
    // Asserted against the gate itself, never through defaultRunClaude — that
    // would start the real CLI and hang on a machine where claude IS installed.
    // A gate that refused everything would pass the refusal cases above.
    for (const a of ["plugin", "marketplace", "add", "list", "update",
      "shipwright-iterate@0.4.1", "https://github.com/x/y.git", "./p", "a-b_c.d"]) {
      expect(SAFE_ARG.test(a)).toBe(true);
    }
  });

  it.each(HOSTILE)("the gate itself rejects %s", (arg) => {
    expect(SAFE_ARG.test(arg)).toBe(false);
  });
});

describe("defaultRunClaude — an unreachable `claude` is a verdict, not a crash", () => {
  it("reports ok:false instead of throwing when nothing resolves on PATH", () => {
    const saved = { PATH: process.env.PATH, Path: process.env.Path };
    // Blank BOTH casings — Windows exposes `Path`, POSIX `PATH`.
    process.env.PATH = "";
    if ("Path" in process.env) process.env.Path = "";
    try {
      const r = defaultRunClaude(["--version"]);
      expect(r.ok).toBe(false);
      /*
       * The SAME verdict on every platform. The two routes there differ — win32
       * refuses BEFORE spawning (delegating a bare name to `cmd /c` would let
       * cmd.exe search the cwd first and run a planted `.\claude.cmd`), while
       * POSIX takes resolveSpawn's pass-through and comes back with an ENOENT
       * spawn error whose stderr is EMPTY. Reporting "" on one OS and a real
       * message on the other was a genuine asymmetry this iterate introduced and
       * then closed (found by external code review).
       */
      expect(r.stderr).toBe("claude not found on PATH");
      expect(r.code).toBeNull();
      expect(r.stdout).toBe("");
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.Path !== undefined) process.env.Path = saved.Path;
    }
  });
});
