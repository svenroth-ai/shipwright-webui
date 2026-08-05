/*
 * Drift guard: `bootstrapper/lib/win32-spawn.mjs` is a deliberate verbatim-ish
 * MIRROR of `server/src/core/win32-spawn.ts` (ADR-044; audit F03 + F31).
 *
 * Run-ID: iterate-2026-07-31-win32-shell-spawn-remediation; re-pointed at the
 * extracted core by iterate-2026-08-01-win32-spawn-followups, which split
 * `preview-win32-spawn.ts` into that core plus a thin throwing wrapper. The
 * mirror was always a mirror of the RESOLVER, never of the preview error type,
 * so the split makes this guard's subject exact rather than approximate.
 *
 * WHY A MIRROR AT ALL. `bootstrapper/` is a separately published npm package
 * (`@svenroth-ai/shipwright`) and DO-NOT #7 forbids cross-package imports, so the
 * shell-free `.cmd`/PATHEXT resolution has to exist twice. The repo's answer to a
 * duplicated shape is a mirror PLUS a drift guard — `action-schema-sync.test.ts`
 * is the established example. This is that guard for this pair.
 *
 * WHY IT LIVES IN THE SERVER PACKAGE. Originally: CI ran vitest for `client` and
 * `server` only, so the same test under `bootstrapper/test/` would have gated
 * nothing. AMENDED 2026-08-01 (iterate-2026-08-01-bootstrapper-ci-contract) —
 * `ci.yml` now HAS a `Bootstrapper (type + lint + test)` job, so that premise is
 * dead, and the honest replacement is narrower than it looks. This test is a
 * SOURCE SCAN: it resolves the repo root and `readFileSync`s BOTH files by
 * absolute path (below), so from either package it would read the same two files
 * and fail on the same edit. Placement decides only WHICH check goes red — and
 * today only this one blocks: `Server (type + lint + test)` is a required
 * context, while the bootstrapper job is deliberately ADVISORY until someone
 * arms it in the ruleset. Moving the file would silently downgrade a blocking
 * guard to a warning. RE-EVALUATE when the bootstrapper job is armed; at that
 * point placement becomes a genuinely free choice.
 *
 * Reading a file from a sibling package is not an import and does not touch the
 * DO-NOT #7 fence.
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
const SERVER_ORIGINAL = resolve(REPO, "server/src/core/win32-spawn.ts");
const BOOTSTRAPPER_MIRROR = resolve(REPO, "bootstrapper/lib/win32-spawn.mjs");

let original = "";
let mirror = "";
/* Comment-stripped twins. The SHARED_INVARIANTS are matched against THESE, not
 * the raw text: both files' headers now discuss `path.win32`, `extname` and the
 * ComSpec `join` in prose, so a raw match would let DOCUMENTATION satisfy an
 * invariant while the code reverted to the host flavour. Same reasoning the
 * `shell:` check below already used — Stage-2 review flagged the inconsistency. */
let originalCode = "";
let mirrorCode = "";

beforeAll(() => {
  original = readFileSync(SERVER_ORIGINAL, "utf-8");
  mirror = readFileSync(BOOTSTRAPPER_MIRROR, "utf-8");
  originalCode = stripComments(original);
  mirrorCode = stripComments(mirror);
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
    // WIN32-FLAVOURED on purpose (iterate-2026-08-01-win32-spawn-followups).
    // A bare `path.join` here is the (a)-class gap: on a POSIX host with the
    // platform stubbed/injected it emits `C:\Win/System32/cmd.exe`. Pinning
    // `path.win32` in the pattern makes the flavour itself un-driftable.
    name: "ComSpec falls back to <SystemRoot>\\System32\\cmd.exe, win32-flavoured",
    pattern: /path\.win32\.join\(root,\s*"System32",\s*"cmd\.exe"\)/,
  },
  {
    name: "extension classification is win32-flavoured, not host-flavoured",
    pattern: /path\.win32\.extname\(/,
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

/**
 * Patterns that must NOT appear in either file's CODE.
 *
 * SHARED_INVARIANTS are >=1 matches, which is the wrong shape for a rule that
 * has to hold at EVERY site: both files call `extname` twice, so a positive
 * `path.win32.extname(` invariant stays green after reverting only the second
 * one. Stage-3 doubt review constructed exactly that bypass. A negative
 * invariant is the shape that scales with the call count.
 */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  {
    name: "an un-flavoured `path.extname(` — every extname site must be win32-pinned",
    pattern: /(?<!win32\.)(?<!posix\.)\bpath\.extname\(/,
  },
  {
    name: "an un-flavoured `path.join(root,` in the ComSpec fallback",
    pattern: /(?<!win32\.)(?<!posix\.)\bpath\.join\(root,/,
  },
];

describe("win32 spawn mirror — security-load-bearing parity", () => {
  it("both files are present and non-trivial", () => {
    expect(original.length).toBeGreaterThan(1000);
    expect(mirror.length).toBeGreaterThan(1000);
  });

  it.each(SHARED_INVARIANTS)("$name — present in the SERVER original", ({ pattern }) => {
    expect(originalCode).toMatch(pattern);
  });

  it.each(SHARED_INVARIANTS)("$name — present in the BOOTSTRAPPER mirror", ({ pattern }) => {
    expect(mirrorCode).toMatch(pattern);
  });

  it.each(FORBIDDEN)("$name — absent from the SERVER original", ({ pattern }) => {
    expect(originalCode).not.toMatch(pattern);
  });

  it.each(FORBIDDEN)("$name — absent from the BOOTSTRAPPER mirror", ({ pattern }) => {
    expect(mirrorCode).not.toMatch(pattern);
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
    expect(mirror).toContain("server/src/core/win32-spawn.ts");
    expect(mirror).toContain("win32-spawn-mirror-parity.test.ts");
  });

  it("the ORIGINAL carries no preview import — that is what the split bought", () => {
    // The mirror could never import the preview subsystem (different package),
    // so before the split the two files disagreed on their single most
    // load-bearing structural property. Now they agree, and this pins it.
    // NOTE this is a single-file, NON-transitive check; the transitive walk
    // lives in server/src/core/win32-spawn.import-closure.test.ts.
    expect(stripComments(original)).not.toMatch(/from\s+"\.\/preview-/);
  });

  it("the mirror still documents its divergences rather than claiming to be identical", () => {
    // The divergence list is what makes a byte-diff of the two files reviewable.
    expect(mirror).toMatch(/DIVERGENCES from the server original/);
    for (const marker of ["PreviewProfileInvalidError", "process.cwd()", "win32ComSpec"]) {
      expect(mirror).toContain(marker);
    }
  });
});
