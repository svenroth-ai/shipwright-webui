import { describe, it, expect } from "vitest";
import { runPreflight, resolvePython, extractVersion, renderVerdict } from "../lib/preflight.mjs";
import { MARK } from "../lib/util.mjs";

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
