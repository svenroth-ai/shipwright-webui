/*
 * win32-spawn — the BOOT path must stay out of the preview ESM cycle (AC-2).
 *
 * Run-ID: iterate-2026-08-01-win32-spawn-followups.
 *
 * WHY THIS IS ITS OWN FILE. Everything here is static import-graph analysis:
 * it reads source text and never stubs `process.platform` or calls the
 * resolver. Its sibling `win32-spawn.test.ts` is the opposite — the resolver's
 * RUNTIME contract, which needs the whole platform/env/tmpdir harness.
 * Splitting on that seam is also what keeps both under the 300-line limit.
 *
 * WHAT IT GUARDS. `PreviewProfileInvalidError` lives in
 * `preview-session-manager.ts`, so before the extraction every consumer of the
 * win32 resolver dragged the preview subsystem into its import closure — which
 * is how `cli-compat.ts`, the boot path, ended up inside the
 * preview-win32-spawn <-> preview-session-manager ESM cycle (PR #340's third
 * deferred item). The split retires that; this proves it stayed retired.
 *
 * WHY TRANSITIVE. A direct "does this file import preview-session-manager"
 * scan passes while an INDIRECT import through any dependency restores the
 * cycle — external plan review raised exactly that (finding 5), so the guard
 * walks the whole relative-import closure instead.
 *
 * WHY THE WALKER HAS ITS OWN FIXTURE TESTS. A guard over real source can be
 * satisfied for the wrong reason. Stage-2 review asked for an assertion that
 * the walker follows a MULTI-LINE import, suggesting
 * `closure(preview-win32-spawn.ts) contains win32-spawn.ts`. Falsification
 * showed that assertion is VACUOUS: that file also carries a single-line
 * `export … from "./win32-spawn.js"`, so the edge is found either way and the
 * test stays green even with a newline-blind regex. The synthetic fixtures
 * below isolate one edge shape each, and each one IS red against the
 * corresponding broken walker. (Verified by breaking it, not by reasoning.)
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = __dirname;

interface Closure {
  /** Every `.ts` module reachable from the entry by RUNTIME import edges. */
  files: string[];
  /** Edges whose target did not resolve to a real `.ts` — a TRUNCATED walk. */
  unresolved: string[];
  /** `import(expr)` with a non-literal specifier — opaque to any source scan. */
  opaqueDynamic: string[];
}

/**
 * Walk the relative-import closure of `entryAbs`.
 *
 * Reports `unresolved` and `opaqueDynamic` rather than swallowing them: Stage-3
 * doubt review constructed both bypasses. A spec that does not map `.js`->`.ts`
 * (a `.mts`, a `.tsx`, a moved barrel, a typo) would silently truncate the walk
 * to green, and a computed `await import(m)` is invisible to the literal regex
 * — and a computed lazy import is exactly the idiom someone reaches for to
 * "break a cycle", so it arrives looking like the fix rather than the
 * regression. Both are now loud.
 */
function walkClosure(entryAbs: string): Closure {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const opaqueDynamic: string[] = [];
  const walk = (abs: string) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const src = readFileSync(abs, "utf-8");
    // A dynamic import whose first argument is not a quoted literal.
    for (const m of src.matchAll(/\bimport\s*\(\s*(?!["'])([^)\s]*)/g)) {
      opaqueDynamic.push(`${abs}: import(${m[1]})`);
    }
    /*
     * Three edge shapes, because a `from`-clause match alone would miss the two
     * that need no binding — a side-effect `import "./x.js"` and a dynamic
     * `await import("./x.js")`. Both create a real load-time edge, so a guard
     * blind to them is a guard with a documented bypass.
     *
     * `[^;]*?` (NOT `[^;\n]*?`) so the header may span newlines: a multi-line
     * `import {\n  X,\n} from "./y.js"` is idiomatic here. `;` still bounds a
     * match to a single statement.
     *
     * `import type` / `export type` are erased by TS and create no load-time
     * edge, so they are skipped — counting them would fail the guard over a
     * dependency that costs nothing at runtime.
     */
    const edges: string[] = [];
    const fromClause = /(?:^|\n)\s*(?:import|export)\b([^;]*?)from\s+["'](\.[^"']+)["']/g;
    const sideEffect = /(?:^|\n)\s*import\s+["'](\.[^"']+)["']/g;
    const dynamic = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromClause.exec(src)) !== null) {
      if (/^\s*type\b/.test(m[1])) continue;
      edges.push(m[2]);
    }
    while ((m = sideEffect.exec(src)) !== null) edges.push(m[1]);
    while ((m = dynamic.exec(src)) !== null) edges.push(m[1]);
    for (const spec of edges) {
      const target = resolvePath(dirname(abs), spec.replace(/\.js$/, ".ts"));
      if (!existsSync(target)) {
        unresolved.push(`${abs} -> ${spec}`);
        continue;
      }
      walk(target);
    }
  };
  walk(entryAbs);
  return { files: [...seen], unresolved, opaqueDynamic };
}

/** Back-compat shorthand for the fixture assertions below. */
function importClosure(entryAbs: string): string[] {
  return walkClosure(entryAbs).files;
}

const tmpDirs: string[] = [];

/** Write a two-file fixture and return the closure of its entry point. */
function closureOfFixture(entrySource: string): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "closure-"));
  tmpDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "entry.ts"), entrySource, "utf-8");
  writeFileSync(path.join(dir, "target.ts"), "export const x = 1;\n", "utf-8");
  return importClosure(path.join(dir, "entry.ts"));
}

const reaches = (closure: string[]) => closure.some((f) => f.endsWith("target.ts"));

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("win32-spawn — the boot path is OUT of the preview ESM cycle (AC-2)", () => {
  it.each(["win32-spawn.ts", "cli-compat.ts"])(
    "%s cannot reach preview-session-manager, directly or transitively",
    (entry) => {
      const { files, unresolved, opaqueDynamic } = walkClosure(resolvePath(CORE_DIR, entry));
      expect(files.length).toBeGreaterThan(0);
      // A truncated walk or an opaque `import(expr)` would make the offender
      // check below pass by not looking, so both fail loudly FIRST.
      expect(unresolved).toEqual([]);
      expect(opaqueDynamic).toEqual([]);
      const offenders = files.filter((f) => /(^|[\\/])preview-[^\\/]*\.ts$/.test(f));
      expect(offenders).toEqual([]);
    },
  );

  it("the guard is not vacuous — the PREVIEW wrapper DOES reach it", () => {
    // If the walker silently found nothing, the test above would pass for the
    // wrong reason. The wrapper must come back dirty.
    const closure = importClosure(resolvePath(CORE_DIR, "preview-win32-spawn.ts"));
    expect(closure.some((f) => f.endsWith("preview-session-manager.ts"))).toBe(true);
  });
});

describe("the import-closure walker follows every edge shape that loads a module", () => {
  it("a single-line `from` import", () => {
    expect(reaches(closureOfFixture('import { x } from "./target.js";\n'))).toBe(true);
  });

  it("a MULTI-LINE `from` import (red against a newline-blind regex)", () => {
    expect(
      reaches(closureOfFixture('import {\n  x,\n  y,\n} from "./target.js";\n')),
    ).toBe(true);
  });

  it("a re-export (`export … from`)", () => {
    expect(reaches(closureOfFixture('export { x } from "./target.js";\n'))).toBe(true);
  });

  it("a side-effect-only import, which binds nothing", () => {
    expect(reaches(closureOfFixture('import "./target.js";\n'))).toBe(true);
  });

  it("a dynamic `await import()`", () => {
    expect(
      reaches(closureOfFixture('export async function f() {\n  await import("./target.js");\n}\n')),
    ).toBe(true);
  });

  it("a single-quoted specifier", () => {
    expect(reaches(closureOfFixture("import { x } from './target.js';\n"))).toBe(true);
  });

  it("but NOT a type-only import — TS erases it, so it is no load-time edge", () => {
    expect(reaches(closureOfFixture('import type { X } from "./target.js";\n'))).toBe(false);
  });

  it("and not a type-only re-export either", () => {
    expect(reaches(closureOfFixture('export type { X } from "./target.js";\n'))).toBe(false);
  });

  it("an inline `type` specifier still counts — the statement is a value import", () => {
    expect(
      reaches(closureOfFixture('import {\n  x,\n  type X,\n} from "./target.js";\n')),
    ).toBe(true);
  });
});

describe("the walker reports what it CANNOT see, instead of going quietly green", () => {
  function walkFixture(entrySource: string) {
    const dir = mkdtempSync(path.join(tmpdir(), "closure-"));
    tmpDirs.push(dir);
    writeFileSync(path.join(dir, "entry.ts"), entrySource, "utf-8");
    writeFileSync(path.join(dir, "target.ts"), "export const x = 1;\n", "utf-8");
    return walkClosure(path.join(dir, "entry.ts"));
  }

  it("an edge that resolves to nothing is REPORTED, not silently dropped", () => {
    // A `.mts`/`.tsx`/moved-barrel/typo spec would otherwise truncate the walk
    // to green — the failure mode is 'guard sees less', which always passes.
    const { unresolved } = walkFixture('import { x } from "./does-not-exist.js";\n');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain("./does-not-exist.js");
  });

  it("a NON-LITERAL dynamic import is REPORTED — no source scan can follow it", () => {
    const { opaqueDynamic } = walkFixture(
      'const m = "./target.js";\nexport async function f() {\n  await import(m);\n}\n',
    );
    expect(opaqueDynamic).toHaveLength(1);
    expect(opaqueDynamic[0]).toContain("import(m)");
  });

  it("a clean fixture reports neither", () => {
    const { unresolved, opaqueDynamic } = walkFixture('import { x } from "./target.js";\n');
    expect(unresolved).toEqual([]);
    expect(opaqueDynamic).toEqual([]);
  });
});
