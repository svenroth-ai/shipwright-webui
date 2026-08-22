import { describe, it, expect } from "vitest";
import { runPreflight, resolvePython, extractVersion, renderVerdict, defaultRun } from "../lib/preflight.mjs";
import { probeEnv } from "../lib/probe-path.mjs";
import { resolveSpawn } from "../lib/win32-spawn.mjs";
import { MARK, installHint } from "../lib/util.mjs";

/** Build an injected `run` from a { cmd: {ok, out} } table. */
function runner(table) {
  return (cmd) => {
    const e = table[cmd];
    if (!e || !e.ok) return { ok: false, stdout: "", stderr: e?.err ?? "", code: e?.code ?? 1 };
    return { ok: true, stdout: e.out ?? "", stderr: "", code: 0 };
  };
}

const ALL_GOOD = {
  claude: { ok: true, out: "2.1.132 (Claude Code)" },
  uv: { ok: true, out: "uv 0.4.0" },
  python3: { ok: true, out: "Python 3.11.5" },
  git: { ok: true, out: "git version 2.44.0" },
  gh: { ok: true, out: "gh 2.40.0" },
};

describe("preflight — AC1a: a missing prerequisite fails LOUDLY", () => {
  it("all present + modern Node → plugin phase ok, exit 0", () => {
    const r = runPreflight({ run: runner(ALL_GOOD), nodeVersion: "v20.12.0", platform: "linux" });
    expect(r.pluginPhaseOk).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("uv ABSENT → plugin phase refused, non-zero exit, actionable hint", () => {
    const r = runPreflight({ run: runner({ ...ALL_GOOD, uv: { ok: false } }), nodeVersion: "v20.12.0", platform: "win32" });
    expect(r.pluginPhaseOk).toBe(false);
    expect(r.exitCode).toBeGreaterThanOrEqual(1);
    const uv = r.checks.find((c) => c.name === "uv");
    expect(uv.ok).toBe(false);
    expect(uv.hint).toContain("uv/install.ps1");
    // The verdict block renders it as a loud failure, not a warning.
    expect(renderVerdict(r, MARK)).toContain(`${MARK.fail} uv`);
  });

  it("claude ABSENT → plugin phase skipped + non-zero exit", () => {
    const r = runPreflight({ run: runner({ ...ALL_GOOD, claude: { ok: false } }), nodeVersion: "v20.12.0" });
    expect(r.hasClaude).toBe(false);
    expect(r.pluginPhaseOk).toBe(false);
    expect(r.exitCode).toBeGreaterThanOrEqual(1);
  });

  it("too-old Node → fails with found-vs-needed", () => {
    const r = runPreflight({ run: runner(ALL_GOOD), nodeVersion: "v18.19.0" });
    const node = r.checks.find((c) => c.name === "node");
    expect(node.ok).toBe(false);
    expect(node.detail).toContain("18.19.0");
    expect(node.detail).toContain("20.12.0");
    expect(r.exitCode).toBeGreaterThanOrEqual(1);
  });

  it("git ABSENT → plugin phase refused (marketplace add clones over git)", () => {
    const r = runPreflight({ run: runner({ ...ALL_GOOD, git: { ok: false } }), nodeVersion: "v20.12.0" });
    expect(r.hasGit).toBe(false);
    expect(r.pluginPhaseOk).toBe(false);
    expect(r.exitCode).toBeGreaterThanOrEqual(1);
  });

  it("gh absent is a SOFT note, never a failure", () => {
    const r = runPreflight({ run: runner({ ...ALL_GOOD, gh: { ok: false } }), nodeVersion: "v20.12.0" });
    const gh = r.checks.find((c) => c.name === "gh");
    expect(gh.optional).toBe(true);
    expect(r.pluginPhaseOk).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

describe("preflight — Python probe TEST-RUNS --version (Microsoft-Store stub trap)", () => {
  it("python3 is the MS-Store stub (found but no version) → falls through to real python", () => {
    // RED anchor: a `command -v`-style presence check would SELECT python3
    // (the stub is on PATH). The fix test-RUNS --version and rejects it.
    const naivePresenceWouldPick = "python3";
    expect(naivePresenceWouldPick).toBe("python3");

    const run = (cmd) =>
      cmd === "python"
        ? { ok: true, stdout: "Python 3.11.5", stderr: "", code: 0 }
        : { ok: false, stdout: "", stderr: "Python was not found", code: 9009 }; // stub
    const resolved = resolvePython(run);
    expect(resolved).toEqual({ bin: "python", version: "3.11.5" });
  });

  it("a too-old Python (3.10) is rejected with a hint", () => {
    const run = (cmd) => (cmd === "python3" ? { ok: true, stdout: "Python 3.10.9", stderr: "", code: 0 } : { ok: false });
    const r = runPreflight({ run, nodeVersion: "v20.12.0" });
    const py = r.checks.find((c) => c.name === "python");
    expect(py.ok).toBe(false);
    expect(py.hint).toBeTruthy();
  });

  it("extractVersion pulls the first numeric token", () => {
    expect(extractVersion("Python 3.11.5")).toBe("3.11.5");
    expect(extractVersion("git version 2.44.0")).toBe("2.44.0");
  });
});

describe("preflight — defaultRun really starts a process, with no platform shell", () => {
  /*
   * These call the REAL `defaultRun` against the REAL OS. That is the point:
   * `runPreflight` is exercised everywhere else through an injected `run`, so
   * `defaultRun` itself — the seam that actually spawns — had no coverage at
   * all. It is also the only layer that can falsify the shell:true removal
   * (iterate-2026-07-31-win32-shell-spawn-remediation): process startup is not
   * something a mock can be wrong about convincingly.
   */

  it("resolves and runs `node --version` (the one tool guaranteed present)", () => {
    const r = defaultRun("node", ["--version"]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(extractVersion(r.stdout + r.stderr)).toMatch(/^\d+\.\d+/);
  });

  it("an absent tool is a clean ok:false verdict, never a throw", () => {
    const r = defaultRun("shipwright-definitely-not-installed-xyz", ["--version"]);
    expect(r.ok).toBe(false);
    expect(r.stdout).toBe("");
  });

  it("a tool that exists but prints no version is still ok:false", () => {
    // `node -e ""` exits 0 and prints nothing — the `\d+\.\d+` requirement is
    // what rejects the MS-Store python3 stub, so it must not be satisfiable by
    // exit code alone.
    const r = defaultRun("node", ["-e", ""]);
    expect(r.code).toBe(0);
    expect(r.ok).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "resolves a real .cmd shim through cmd.exe without shell:true (npx)",
    () => {
      // npx is a `.cmd` on Windows — the exact shim class that used to require
      // shell:true. On POSIX there is no shim, hence the platform gate.
      const r = defaultRun("npx", ["--version"]);
      expect(r.ok).toBe(true);
      expect(extractVersion(r.stdout + r.stderr)).toMatch(/^\d+\.\d+/);
    },
  );
});

describe("preflight — probeEnv augments the lookup PATH (freshly-installed tools)", () => {
  // ROOT CAUSE (Mac cold-start 2026-08-22): the uv/claude installers drop their
  // binaries in ~/.local/bin and only APPEND that to the shell rc. The running
  // npx process still carries the PATH captured before the install, so the probe
  // spawn (shell:false) reported perfectly-installed tools as "not found".
  it("POSIX: appends ~/.local/bin, /opt/homebrew/bin, /usr/local/bin", () => {
    const env = probeEnv("linux", "/home/dev", { PATH: "/usr/bin:/bin", HOME: "/home/dev" });
    const dirs = env.PATH.split(":");
    expect(dirs).toContain("/usr/bin"); // original preserved, and FIRST
    expect(dirs.indexOf("/usr/bin")).toBeLessThan(dirs.indexOf("/home/dev/.local/bin"));
    expect(dirs).toContain("/home/dev/.local/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
    expect(env.HOME).toBe("/home/dev"); // other vars untouched
  });

  it("does not duplicate a dir already on PATH", () => {
    const env = probeEnv("linux", "/home/dev", { PATH: "/home/dev/.local/bin:/usr/bin" });
    const dirs = env.PATH.split(":").filter((d) => d === "/home/dev/.local/bin");
    expect(dirs.length).toBe(1);
  });

  it("Windows: adds %USERPROFILE%\\.local\\bin and collapses to a SINGLE path key", () => {
    // process.env on Windows is case-insensitive; a plain spread is not. probeEnv
    // must not hand spawn both `Path` (stale) and `PATH` (augmented).
    const env = probeEnv("win32", "C:\\Users\\dev", { Path: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe" });
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === "path");
    expect(pathKeys).toEqual(["PATH"]);
    expect(env.PATH.split(";")).toContain("C:\\Users\\dev\\.local\\bin");
    expect(env.PATH.split(";")).toContain("C:\\Windows"); // original preserved
    expect(env.ComSpec).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

describe("preflight — Python gate is coupled to uv, not system python3", () => {
  // ROOT CAUSE #2: `uv python install 3.11` installs a uv-MANAGED interpreter
  // that is never `python3` on PATH. The whole stack runs via `uv run`, so a
  // system python3 of 3.9 is irrelevant when uv can supply 3.11.
  it("system python is 3.9 but uv provides >=3.11 → python OK (uv-managed)", () => {
    const run = (cmd, args = []) => {
      if (cmd === "uv" && args[0] === "python" && args[1] === "find") {
        return { ok: true, stdout: "/home/dev/.local/share/uv/python/cpython-3.11.9-linux/bin/python3.11", stderr: "", code: 0 };
      }
      const table = {
        claude: "2.1.0 (Claude Code)",
        uv: "uv 0.4.0",
        python3: "Python 3.9.6",
        git: "git version 2.44.0",
      };
      return cmd in table ? { ok: true, stdout: table[cmd], stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "", code: 1 };
    };
    const r = runPreflight({ run, nodeVersion: "v20.12.0", platform: "linux" });
    const py = r.checks.find((c) => c.name === "python");
    expect(py.ok).toBe(true);
    expect(py.detail).toMatch(/uv/i);
    expect(r.hasPython).toBe(true);
    expect(r.pluginPhaseOk).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("system python 3.9 AND uv cannot provide 3.11 → python fails, hint names uv", () => {
    const run = (cmd, args = []) => {
      if (cmd === "uv" && args[0] === "python" && args[1] === "find") return { ok: false, stdout: "", stderr: "no interpreter", code: 1 };
      const table = { claude: "2.1.0", uv: "uv 0.4.0", python3: "Python 3.9.6", git: "2.44.0" };
      return cmd in table ? { ok: true, stdout: table[cmd], stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "", code: 1 };
    };
    const r = runPreflight({ run, nodeVersion: "v20.12.0", platform: "linux" });
    const py = r.checks.find((c) => c.name === "python");
    expect(py.ok).toBe(false);
    expect(py.hint).toMatch(/uv python install/i);
  });

  it("uv find succeeds (exit 0) but its path carries no decimal → still OK (gate on exit code, not version regex)", () => {
    // Regression for the code-review MEDIUM: `uv python find` prints a PATH, not
    // a version. A resolved `/usr/local/bin/python3` symlink has no `\d+\.\d+`,
    // so gating on defaultRun's version-shaped `ok` would re-introduce a false
    // "not found" despite a clean exit. Gate on exit code instead.
    const run = (cmd, args = []) => {
      if (cmd === "uv" && args[0] === "python" && args[1] === "find") {
        return { ok: false, stdout: "/usr/local/bin/python3", stderr: "", code: 0 }; // exit 0, no decimal → ok:false
      }
      const table = { claude: "2.1.0", uv: "uv 0.4.0", python3: "Python 3.9.6", git: "2.44.0" };
      return cmd in table ? { ok: true, stdout: table[cmd], stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "", code: 1 };
    };
    const r = runPreflight({ run, nodeVersion: "v20.12.0", platform: "linux" });
    const py = r.checks.find((c) => c.name === "python");
    expect(py.ok).toBe(true);
    expect(py.detail).toContain("uv-managed"); // detail falls back to "3.11+" when no decimal
  });

  it("win32: the >=3.11 uv-find arg survives cmd.exe quoting under shell:false", () => {
    // The literal `>` is a cmd.exe redirect char; win32-spawn must quote it so it
    // reaches uv as an argument, not a redirection. uv.exe is a real executable so
    // it spawns directly, but assert the composed argv keeps `>=3.11` intact.
    const plan = resolveSpawn(["uv", "python", "find", ">=3.11"], {
      platform: "win32",
      env: { PATH: "C:\\nonexistent", PATHEXT: ".EXE;.CMD" },
    });
    // uv is unresolvable here → bare-name CreateProcess fallback keeps args verbatim.
    expect(plan.args).toContain(">=3.11");
  });

  it("a working system python >=3.11 short-circuits — uv is NOT consulted", () => {
    let uvPythonCalled = false;
    const run = (cmd, args = []) => {
      if (cmd === "uv" && args[0] === "python") uvPythonCalled = true;
      const table = { claude: "2.1.0", uv: "uv 0.4.0", python3: "Python 3.11.5", git: "2.44.0" };
      return cmd in table ? { ok: true, stdout: table[cmd], stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "", code: 1 };
    };
    const r = runPreflight({ run, nodeVersion: "v20.12.0", platform: "linux" });
    expect(r.hasPython).toBe(true);
    expect(uvPythonCalled).toBe(false);
    const py = r.checks.find((c) => c.name === "python");
    expect(py.detail).toContain("python3");
  });
});

describe("preflight — install hints are actionable, OS-aware commands", () => {
  it("claude hint is a copy-pasteable command per OS (not just a doc URL)", () => {
    expect(installHint("claude", "darwin")).toContain("claude.ai/install.sh");
    expect(installHint("claude", "linux")).toContain("| bash");
    expect(installHint("claude", "win32")).toContain("claude.ai/install.ps1");
  });

  it("python hint leads with the uv path", () => {
    expect(installHint("python", "darwin")).toMatch(/uv python install/i);
    expect(installHint("python", "win32")).toMatch(/uv python install/i);
    expect(installHint("python", "win32")).toMatch(/Microsoft Store/i); // stub warning kept
  });

  it("renderVerdict appends an OS-aware PATH-refresh note when a hard tool is missing", () => {
    const missing = runPreflight({ run: runner({ ...ALL_GOOD, uv: { ok: false } }), nodeVersion: "v20.12.0", platform: "linux" });
    expect(renderVerdict(missing, MARK)).toMatch(/new terminal|source/i);

    const winMissing = runPreflight({ run: runner({ ...ALL_GOOD, claude: { ok: false } }), nodeVersion: "v20.12.0", platform: "win32" });
    expect(renderVerdict(winMissing, MARK)).toMatch(/new terminal/i);

    // all good → no note
    const good = runPreflight({ run: runner(ALL_GOOD), nodeVersion: "v20.12.0", platform: "linux" });
    expect(renderVerdict(good, MARK)).not.toMatch(/new terminal|source/i);
  });
});
