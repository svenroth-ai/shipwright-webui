/*
 * Drift guard: `bootstrapper/lib/win32-spawn.mjs` is a deliberate verbatim-ish
 * MIRROR of `server/src/core/preview-win32-spawn.ts` (ADR-044; audit F03 + F31).
 *
 * Run-ID: iterate-2026-07-31-win32-shell-spawn-remediation.
 *
 * WHY A MIRROR AT ALL. `bootstrapper/` is a separately published npm package
 * (`@svenroth-ai/shipwright`) and DO-NOT #7 forbids cross-package imports, so the
 * shell-free `.cmd`/PATHEXT resolution has to exist twice. The repo's answer to a
 * duplicated shape is a mirror PLUS a drift guard — `action-schema-sync.test.ts`
 * is the established example. This is that guard for this pair.
 *
 * WHY IT LIVES IN THE SERVER PACKAGE. CI runs vitest for `client` and `server`
 * only (`.github/workflows/ci.yml` — there is no bootstrapper job), so the same
 * test placed under `bootstrapper/test/` would gate nothing. Reading a file from
 * a sibling package is not an import and does not touch the DO-NOT #7 fence.
 *
 * WHAT IT CAN AND CANNOT DO. The two files are not byte-comparable — one is TS
 * with a `cwd` parameter and a throwing branch, the other is ESM with injected
 * `platform`/`env` and a null branch (the divergences are enumerated in the
 * mirror's own header). So this asserts that the SECURITY-LOAD-BEARING decisions
 * appear in BOTH: the same extension sets, the same cmd.exe invocation shape, the
 * PATH-only rule for bare names, the realpath+isFile check, and the refusal to
 * delegate an unresolved bare name. It cannot prove the two behave identically —
 * that is what each package's own contract tests are for. It CAN fail loudly when
 * someone edits one file's security posture and forgets the other, which is the
 * failure this pair actually risks.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/test → repo root
const REPO = resolve(__dirname, "..", "..", "..");
const SERVER_ORIGINAL = resolve(REPO, "server/src/core/preview-win32-spawn.ts");
const BOOTSTRAPPER_MIRROR = resolve(REPO, "bootstrapper/lib/win32-spawn.mjs");

let original = "";
let mirror = "";

beforeAll(() => {
  original = readFileSync(SERVER_ORIGINAL, "utf-8");
  mirror = readFileSync(BOOTSTRAPPER_MIRROR, "utf-8");
});

/** Drop block + line comments, keeping line structure so `^`-anchors still work. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead);
}

/** Invariants that must hold in BOTH files, or the mirror has drifted. */
const SHARED_INVARIANTS: { name: string; pattern: RegExp }[] = [
  {
    name: "the executable extension set is .exe + .com",
    pattern: /WIN32_EXECUTABLE_EXTS\s*=\s*new Set\(\[\s*"\.exe",\s*"\.com"\s*\]\)/,
  },
  {
    name: "the shim extension set is .cmd + .bat",
    pattern: /WIN32_SHIM_EXTS\s*=\s*new Set\(\[\s*"\.cmd",\s*"\.bat"\s*\]\)/,
  },
  {
    name: "cmd.exe is invoked as /d /s /c with discrete argv",
    pattern: /\["\/d",\s*"\/s",\s*"\/c",\s*\.\.\.parts\]/,
  },
  {
    name: "a spaced token produces the verbatim outer-quoted line",
    pattern: /windowsVerbatimArguments:\s*true/,
  },
  {
    name: "the outer-quote wrap is built from per-token quoting",
    pattern: /win32NeedsQuote\(p\)\s*\?\s*`"\$\{p\}"`\s*:\s*p/,
  },
  {
    name: "a candidate is realpath-verified before use",
    pattern: /realpathSync\.native\(base \+ ext\)/,
  },
  {
    name: "and must be a regular file",
    pattern: /statSync\(real\)\.isFile\(\)/,
  },
  {
    name: "PATHEXT has the same default when unset",
    pattern: /\?\?\s*"\.COM;\.EXE;\.BAT;\.CMD"/,
  },
  {
    name: "ComSpec falls back to <SystemRoot>/System32/cmd.exe",
    pattern: /path\.join\(root,\s*"System32",\s*"cmd\.exe"\)/,
  },
  {
    name: "a bare name is searched on PATH only (the empty ext is excluded)",
    pattern: /firstFile\(path\.join\((?:dir|trimmed),\s*name\),\s*false\)/,
  },
  {
    name: "a path-like name may match with no extension at all",
    pattern: /withBare\s*\?\s*\["",\s*\.\.\.exts\]\s*:\s*exts/,
  },
  {
    name: "looksPathLike accepts both separators and a drive letter",
    pattern: /name\.includes\("\\\\"\)\s*\|\|\s*name\.includes\("\/"\)\s*\|\|\s*\/\^\[a-zA-Z\]:\/\.test\(name\)/,
  },
  {
    name: "an unresolved BARE name is refused, never delegated to cmd.exe",
    pattern: /if\s*\(!looksPathLike\(name\)\)/,
  },
];

describe("win32 spawn mirror — security-load-bearing parity", () => {
  it("both files are present and non-trivial", () => {
    expect(original.length).toBeGreaterThan(1000);
    expect(mirror.length).toBeGreaterThan(1000);
  });

  it.each(SHARED_INVARIANTS)("$name — present in the SERVER original", ({ pattern }) => {
    expect(original).toMatch(pattern);
  });

  it.each(SHARED_INVARIANTS)("$name — present in the BOOTSTRAPPER mirror", ({ pattern }) => {
    expect(mirror).toMatch(pattern);
  });

  it("neither file sets a `shell` option in CODE — that is the whole point", () => {
    // Comments must be stripped first: both headers discuss `shell: true` in
    // prose precisely because removing it is what they are for. Same approach as
    // no-cross-package-imports.test.ts.
    for (const src of [stripComments(original), stripComments(mirror)]) {
      expect(src).not.toMatch(/shell:\s*true/);
      // `shell` must not appear as an option key at all in the returned plan.
      expect(src).not.toMatch(/^\s*shell:/m);
    }
  });

  it("the mirror still points at the original, so this guard is discoverable", () => {
    expect(mirror).toContain("server/src/core/preview-win32-spawn.ts");
    expect(mirror).toContain("win32-spawn-mirror-parity.test.ts");
  });

  it("the mirror still documents its divergences rather than claiming to be identical", () => {
    // The divergence list is what makes a byte-diff of the two files reviewable.
    expect(mirror).toMatch(/DIVERGENCES from the server original/);
    for (const marker of ["PreviewProfileInvalidError", "process.cwd()", "win32ComSpec"]) {
      expect(mirror).toContain(marker);
    }
  });
});
