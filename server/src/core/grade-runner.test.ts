/*
 * grade-runner — the injection-safe, read-only grade bridge (A09b, FR-01.53).
 *
 * RED on pre-A09b main, green after. Every grade.py outcome is mapped to an
 * honest state, and the spawn is asserted injection-safe: the target lands as a
 * FIXED argv position (never a shell string), --format json is fixed, and CI
 * mocks the subprocess (no live grade.py / clone). Round-trip fixtures are the
 * REAL grade.py shapes captured during the A09b confidence-calibration probe
 * (authoritative all-scored + cold all-n/a, schema_version 1.0, fractional
 * dimension scores/weights).
 */

import { describe, it, expect, vi } from "vitest";

import {
  runGrade,
  type SpawnGradeFn,
  type SpawnResult,
} from "./grade-runner.js";
import { ENV_COMPLIANCE_ROOT } from "./grade-target.js";

/** A working python resolver — resolvePython uses `run(bin, ["--version"])`. */
const okRun = () => Promise.resolve({ ok: true, stdout: "Python 3.12.13", stderr: "" });
const noPython = () => Promise.resolve({ ok: false, stdout: "", stderr: "" });

/** A real captured grade.py --format json payload (authoritative, all scored). */
const AUTH_MODEL = {
  schema_version: "1.0",
  grade: "A",
  score: 97.4,
  na_count: 0,
  measurable_count: 7,
  dimensions: [{ key: "test_health", status: "ok", score: 1.0, weight: 0.25 }],
};

/** Base deps that make the engine "present" without touching a real cache. */
function engineDeps(spawn: SpawnGradeFn) {
  return {
    run: okRun,
    spawn,
    statDir: () => true, // any local path "exists"
    scriptOverride: "/cache/shipwright-grade/0.29.1/scripts/tools/grade.py",
    complianceOverride: "/cache/shipwright-compliance/0.2.2",
    existsFn: () => true,
    baseEnv: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
  };
}

function spawnReturning(result: Partial<SpawnResult>): SpawnGradeFn {
  return vi.fn(async () => ({ code: 0, stdout: "", stderr: "", ...result }));
}

describe("runGrade — the spawn is injection-safe (fixed argv, shell:false)", () => {
  // @covers FR-01.53
  it("passes the target as a FIXED argv position, never a shell string", async () => {
    const spawn = vi.fn<SpawnGradeFn>(async () => ({
      code: 0,
      stdout: JSON.stringify(AUTH_MODEL),
      stderr: "",
    }));
    const target = "C:/work/api server; rm -rf /"; // metachars + spaces
    await runGrade({ target }, engineDeps(spawn));

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe("python3"); // the fixed-literal python binary
    // args = [script, "--format", "json", "--", target]. The `--` end-of-options
    // separator + fixed positional means a `--no-clone`-style target can never be
    // read as a grade.py flag (argument-injection defence).
    expect(args.slice(1)).toEqual(["--format", "json", "--", target]);
    expect(args[args.length - 1]).toBe(target); // the target is the LAST, lone member
    // No arg is a concatenated shell line — the target is its own lone member.
    expect(args.filter((a) => a.includes("--format json"))).toHaveLength(0);
    // The compliance root is injected via env so grade.py's engine resolves.
    expect(opts.env[ENV_COMPLIANCE_ROOT]).toBe("/cache/shipwright-compliance/0.2.2");
  });
});

describe("runGrade — honest outcome mapping for every grade.py exit", () => {
  // @covers FR-01.53
  it("exit 0 + valid JSON → report-ready with the RAW model (no reshape)", async () => {
    const spawn = spawnReturning({ stdout: JSON.stringify(AUTH_MODEL) });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("report-ready");
    expect(out.model).toEqual(AUTH_MODEL); // byte-for-byte, never fabricated
  });

  // @covers FR-01.53
  it("exit 2 (TargetError) → grade-failed with the plugin's plain reason", async () => {
    const spawn = spawnReturning({ code: 2, stderr: "shipwright-grade: path does not exist: C:/x" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("grade-failed");
    expect(out.reason).toBe("path does not exist: C:/x"); // prefix stripped
  });

  // @covers FR-01.53
  it("exit 3 (EngineUnavailable) → engine-unavailable + the repair command", async () => {
    const spawn = spawnReturning({ code: 3, stderr: "shipwright-grade: engine unavailable: ..." });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("engine-unavailable");
    expect(out.repairCommand).toMatch(/npx @svenroth-ai\/shipwright/);
  });

  // @covers FR-01.53
  it("a spawn failure (python vanished, code -1) → engine-unavailable", async () => {
    const spawn = spawnReturning({ code: -1, spawnError: "ENOENT" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("engine-unavailable");
  });

  // @covers FR-01.53
  it("a timeout kill (code 124) → grade-failed with a 'took too long' reason", async () => {
    const spawn = spawnReturning({ code: 124, spawnError: "timeout" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("grade-failed");
    expect(out.reason).toMatch(/too long/i);
  });

  // @covers FR-01.53
  it("any other non-zero exit → grade-failed", async () => {
    const spawn = spawnReturning({ code: 1, stderr: "boom" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("grade-failed");
  });

  // @covers FR-01.53
  it("exit 0 but non-JSON stdout → shape-unrecognised (never a fabricated card)", async () => {
    const spawn = spawnReturning({ stdout: "not json at all" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("shape-unrecognised");
  });

  // @covers FR-01.53
  it("exit 0 but a JSON array (not an object) → shape-unrecognised", async () => {
    const spawn = spawnReturning({ stdout: "[1,2,3]" });
    const out = await runGrade({ target: "C:/repo" }, engineDeps(spawn));
    expect(out.status).toBe("shape-unrecognised");
  });
});

describe("runGrade — pre-spawn gates (no subprocess when they fail)", () => {
  // @covers FR-01.53
  it("an invalid target → grade-failed WITHOUT spawning", async () => {
    const spawn = spawnReturning({});
    const out = await runGrade({ target: "   " }, engineDeps(spawn));
    expect(out.status).toBe("grade-failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  // @covers FR-01.53
  it("a non-existent local dir → grade-failed WITHOUT spawning", async () => {
    const spawn = spawnReturning({});
    const out = await runGrade(
      { target: "C:/ghost" },
      { ...engineDeps(spawn), statDir: () => false },
    );
    expect(out.status).toBe("grade-failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  // @covers FR-01.53
  it("no grade.py on disk → engine-unavailable WITHOUT spawning", async () => {
    const spawn = spawnReturning({});
    const out = await runGrade(
      { target: "C:/repo" },
      { ...engineDeps(spawn), scriptOverride: undefined, existsFn: () => false, readdirFn: () => [] },
    );
    expect(out.status).toBe("engine-unavailable");
    expect(spawn).not.toHaveBeenCalled();
  });

  // @covers FR-01.53
  it("no working python → engine-unavailable WITHOUT spawning", async () => {
    const spawn = spawnReturning({});
    const out = await runGrade({ target: "C:/repo" }, { ...engineDeps(spawn), run: noPython });
    expect(out.status).toBe("engine-unavailable");
    expect(spawn).not.toHaveBeenCalled();
  });
});
