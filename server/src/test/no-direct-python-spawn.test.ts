/*
 * Drift-guard: `resolvePython(` may be called ONLY from within its own
 * module (readiness-probe-run.ts) and its sanctioned reader
 * (readiness-probe.ts, which version-gates the result for the /api/readiness
 * DISPLAY — it never spawns a script with it). Any other call site is the
 * silent-fallback pattern behind the ModuleNotFoundError bug
 * (iterate-2026-08-26-grade-uv-run): grade-runner.ts and triage-cli-runner.ts
 * each used to resolve a bare python3/python/py this way and spawn it to run
 * a plugin-owned script built for `uv run`, discarding the readiness gate's
 * own "no working Python (3.11+)" verdict.
 *
 * See also no-indirect-python-spawn.test.ts, which guards the raw
 * execFile()/spawn() literal-target class this check doesn't cover.
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

/** Paths relative to server/src, forward-slash normalized. */
export const RESOLVE_PYTHON_CALL_ALLOWLIST = new Set(["core/readiness-probe.ts", "core/readiness-probe-run.ts"]);

export const RESOLVE_PYTHON_CALL_RE = /resolvePython\s*\(/;

describe("drift-guard: resolvePython( is called only from its sanctioned readers", () => {
  it("resolvePython( is called only from readiness-probe.ts / readiness-probe-run.ts", () => {
    const files = walk(SERVER_SRC);
    const offenders: { file: string; line: number }[] = [];

    for (const file of files) {
      if (RESOLVE_PYTHON_CALL_ALLOWLIST.has(relToServerSrc(file))) continue;
      const stripped = stripCommentsPreserveLines(readSource(file));
      const m = RESOLVE_PYTHON_CALL_RE.exec(stripped);
      if (m) offenders.push({ file, line: indexToLine(stripped, m.index) });
    }

    expect(
      offenders,
      offenders.length
        ? `resolvePython() called outside its sanctioned readers (use uv-runner.ts's resolveUv instead — never spawn its raw .bin):\n${offenders
            .map((o) => `  ${o.file}:${o.line}`)
            .join("\n")}`
        : "ok",
    ).toEqual([]);
  });

  it("flags a synthetic resolvePython( call in a non-allowlisted file (sanity)", () => {
    const synthetic = `const py = await resolvePython(run);`;
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(RESOLVE_PYTHON_CALL_RE.test(stripped)).toBe(true);
  });

  it("the allowlist matches a relative path, not a bare basename (sanity)", () => {
    expect(RESOLVE_PYTHON_CALL_ALLOWLIST.has("readiness-probe.ts")).toBe(false);
    expect(RESOLVE_PYTHON_CALL_ALLOWLIST.has("core/readiness-probe.ts")).toBe(true);
  });

  it("does not flag a doc comment mentioning resolvePython (sanity)", () => {
    const synthetic = [
      `/**`,
      ` * See readiness-probe-run.ts's resolvePython(run) for the raw probe.`,
      ` */`,
      `export const x = 1;`,
    ].join("\n");
    const stripped = stripCommentsPreserveLines(synthetic);
    expect(RESOLVE_PYTHON_CALL_RE.test(stripped)).toBe(false);
  });
});
