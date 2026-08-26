/*
 * Drift-guard: no call site in server/src/ may spawn a Python interpreter
 * directly, even bypassing `resolvePython()` entirely
 * (iterate-2026-08-26-grade-uv-run). Companion to
 * no-direct-python-spawn.test.ts, which guards the sanctioned function; this
 * file guards the raw literal-target class the ModuleNotFoundError bug also
 * belonged to.
 *
 * Three checks, all source-scans (no real toolchain needed):
 *   1. No file hardcodes a literal "python3"/"python"/"py" (any of `"`, `'`,
 *      or a plain backtick string) as the first argument to execFile()/
 *      spawn().
 *   2. No file assigns that literal to a variable which is then passed to
 *      execFile()/spawn() (`const py = "python3"; ...; spawn(py, ...)`), the
 *      one-hop indirection an external code review (2026-08-26) found check 1
 *      alone does not catch.
 *   3. No non-allowlisted file reimplements the python3→python→py probe LOOP
 *      inline (the literal array `["python3", "python", "py"]` from
 *      readiness-probe-run.ts, copied into a new call site) — this would trip
 *      neither of the above, since its spawn target is a loop variable, not a
 *      direct literal or a single flat assignment. A Stage-3 doubt review
 *      (2026-08-26) found this gap in the first hardening pass.
 */

import { describe, it, expect } from "vitest";
import {
  indexToLine,
  readSource,
  relToServerSrc,
  SERVER_SRC,
  stripCommentsPreserveLines,
  walk,
} from "./python-spawn-guard-util.js";
import { RESOLVE_PYTHON_CALL_ALLOWLIST } from "./no-direct-python-spawn.test.js";

const RAW_PYTHON_SPAWN_RE = /(?:execFile|spawn)\(\s*[`"'](?:python3|python|py)[`"']/;
const PYTHON_LITERAL_VAR_ASSIGN_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*[`"'](?:python3|python|py)[`"']/g;
/** The exact python3→python→py probe array literal from readiness-probe-run.ts. */
const PROBE_ARRAY_LITERAL_RE = /\[\s*["'`]python3["'`]\s*,\s*["'`]python["'`]\s*,\s*["'`]py["'`]\s*\]/;

describe("drift-guard: no indirect Python-interpreter spawn in server/src", () => {
  it("no call site hardcodes a literal python3/python/py as an execFile/spawn target", () => {
    const files = walk(SERVER_SRC);
    const offenders: { file: string; line: number }[] = [];

    for (const file of files) {
      const stripped = stripCommentsPreserveLines(readSource(file));
      const m = RAW_PYTHON_SPAWN_RE.exec(stripped);
      if (m) offenders.push({ file, line: indexToLine(stripped, m.index) });
    }

    expect(
      offenders,
      offenders.length
        ? `A literal python3/python/py spawn target found (route through uv-runner.ts's resolveUv instead):\n${offenders
            .map((o) => `  ${o.file}:${o.line}`)
            .join("\n")}`
        : "ok",
    ).toEqual([]);
  });

  it("no call site hides a literal python3/python/py behind a one-hop variable indirection", () => {
    const files = walk(SERVER_SRC);
    const offenders: { file: string; line: number; variable: string }[] = [];

    for (const file of files) {
      const stripped = stripCommentsPreserveLines(readSource(file));
      for (const m of stripped.matchAll(PYTHON_LITERAL_VAR_ASSIGN_RE)) {
        const variable = m[1];
        const spawnRe = new RegExp(`(?:execFile|spawn)\\(\\s*${variable}\\b`);
        if (spawnRe.test(stripped)) {
          offenders.push({ file, line: indexToLine(stripped, m.index ?? 0), variable });
        }
      }
    }

    expect(
      offenders,
      offenders.length
        ? `A python3/python/py literal assigned to a variable later passed to execFile/spawn (route through uv-runner.ts's resolveUv instead):\n${offenders
            .map((o) => `  ${o.file}:${o.line} (var: ${o.variable})`)
            .join("\n")}`
        : "ok",
    ).toEqual([]);
  });

  it("no non-allowlisted file reimplements the python3/python/py probe loop inline", () => {
    const files = walk(SERVER_SRC);
    const offenders: { file: string; line: number }[] = [];

    for (const file of files) {
      if (RESOLVE_PYTHON_CALL_ALLOWLIST.has(relToServerSrc(file))) continue;
      const stripped = stripCommentsPreserveLines(readSource(file));
      const m = PROBE_ARRAY_LITERAL_RE.exec(stripped);
      if (m) offenders.push({ file, line: indexToLine(stripped, m.index) });
    }

    expect(
      offenders,
      offenders.length
        ? `The python3→python→py probe array is reimplemented outside readiness-probe-run.ts (call resolvePython(), or better, uv-runner.ts's resolveUv, instead):\n${offenders
            .map((o) => `  ${o.file}:${o.line}`)
            .join("\n")}`
        : "ok",
    ).toEqual([]);
  });

  it("flags a synthetic literal python3 spawn (sanity)", () => {
    const synthetic = `const r = await spawn("python3", [script], opts);`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(RAW_PYTHON_SPAWN_RE.test(stripped)).toBe(true);
  });

  it("flags a synthetic backtick-literal python3 spawn (sanity)", () => {
    const synthetic = "const r = await execFile(`python3`, [script], opts);";
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(RAW_PYTHON_SPAWN_RE.test(stripped)).toBe(true);
  });

  it("flags a synthetic one-hop variable-indirection spawn (sanity)", () => {
    const synthetic = `const py = "python3"; const r = await spawn(py, [script], opts);`;
    const stripped = stripCommentsPreserveLines(synthetic);
    const matches = [...stripped.matchAll(PYTHON_LITERAL_VAR_ASSIGN_RE)];
    expect(matches).toHaveLength(1);
    expect(new RegExp(`(?:execFile|spawn)\\(\\s*${matches[0][1]}\\b`).test(stripped)).toBe(true);
  });

  it("flags a synthetic inline reimplementation of the probe loop (sanity)", () => {
    const synthetic = `for (const bin of ["python3", "python", "py"]) { await execFile(bin, ["--version"]); }`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(PROBE_ARRAY_LITERAL_RE.test(stripped)).toBe(true);
  });
});
