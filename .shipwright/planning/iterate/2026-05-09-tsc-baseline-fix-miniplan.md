# Mini-Plan: tsc-baseline-fix

- **Run ID:** iterate-2026-05-09-tsc-baseline-fix
- **Spec:** [2026-05-09-tsc-baseline-fix.md](2026-05-09-tsc-baseline-fix.md)

## Approach

Two independent root causes feeding 4 errors. Address each surgically:

### Root cause A — Cross-package type imports violate `rootDir: ./src`

`server/src/core/project-manager.ts:3` imports `Project` from
`../../../client/src/types/project.js`. `server/src/routes/settings.ts:2`
imports `GlobalSettings` from `../../../client/src/types/settings.js`.
The TS6059 error fires because `tsc` pulls the imported `.ts` file into
the compilation graph, then complains that it sits outside the configured
`rootDir`. The transitive errors on `client/src/types/project.ts:1` /
`:2` come from `project.ts` itself importing `./task.js` and `./settings.js`
— same rule, deeper in the chain.

**Fix:** Duplicate the three shape files into `server/src/types/`
(direction approved: server owns its wire-shape view; client keeps its
own copy. Drift surfaces immediately at the JSON boundary as runtime
contract test failure or compile error elsewhere).

- New `server/src/types/task.ts` — verbatim mirror of
  `client/src/types/task.ts`, plus a header comment naming the canonical
  origin and ADR-080.
- New `server/src/types/settings.ts` — verbatim mirror.
- New `server/src/types/project.ts` — verbatim mirror; transitively
  imports `./task.js` + `./settings.js` from the new local copies.
- Edit `server/src/core/project-manager.ts:3` →
  `import type { Project } from "../types/project.js";`
- Edit `server/src/routes/settings.ts:2` →
  `import type { GlobalSettings } from "../types/settings.js";`

### Root cause B — `proper-lockfile` has no bundled types

`server/src/index.ts:23` imports `* as lockfile from "proper-lockfile"`,
which ships JS-only without `.d.ts`. TS7016 fires because `noImplicitAny`
+ strict mode reject ambient-`any` modules.

**Fix:** Install `@types/proper-lockfile` pinned to the SAME major as
the runtime `proper-lockfile`. `server/package.json` declares
`"proper-lockfile": "^4.1.0"`, so install `@types/proper-lockfile@^4.0.0`
(latest DefinitelyTyped major matching runtime v4). This addresses
OpenAI review finding #5 + #10 + Gemini finding #4. Falls back to a
local ambient `.d.ts` shim if the published types diverge from the
narrow `lockfile` API surface our `index.ts` actually uses
(`lock` / `unlock` / `check` are the only entry points referenced).

### Drift-protection — guard test against re-introduction

The actually-shipped failure mode is "future iterate adds a new
`from \"../../../client/src/types/...\"` import". Catch it with a fast
unit test that's resilient to relative-depth changes, dynamic imports,
and re-export syntax (per OpenAI review finding #2 + Gemini finding #1):

- New `server/src/test/no-cross-package-imports.test.ts` — uses Vitest +
  built-in `fs.readdirSync` (no `glob` dep — addresses OpenAI #3; no
  `recursive: true` Node-version assumption — addresses Gemini #3).
  Walks `server/src/**/*.ts` with a small manual recursion (3-5 lines).
  Excludes `**/*.test.ts`, `**/*.d.ts`, `dist/`.
- Two regex patterns assert no match across the whole file content:
  - `from\s+['"](?:\.\.\/)+client\//` — covers `import x from "..."`
    AND `export type X from "..."` AND any depth of `../`.
  - `import\s*\(\s*['"](?:\.\.\/)+client\//` — covers
    `import("../../../client/...")` dynamic imports.
- Failure message names the offending file + matched line content.
- Test runs in default `server/` `npm run test` (vitest pulls
  `**/*.test.ts`).
- Belt-and-braces sweep: also do a one-time `git grep` for
  `(\.\./)+client/` across the WHOLE repo (not just `server/src/**`)
  during build phase, to catch any other lurking cross-package import
  that might exist outside the test scope (OpenAI review finding #9).
  Document findings in self-review.

### Stray-artifact cleanup

`client/src/types/{project,settings,task}.{js,d.ts,d.ts.map,js.map}`
were emitted by a prior aborted `tsc` run that pulled the cross-package
files in. They're untracked, unused (Vite transpiles `.ts` directly,
never imports `.js` siblings), and clutter `git status`. Pure deletion.

OpenAI review finding #8 noted these are untracked, so AC-4 is
non-reproducible across environments where they never existed —
that's CORRECT: AC-4 is one-time hygiene for THIS working tree only,
not a persistent code-delta. Future regression is structurally
prevented because the underlying root cause (cross-package import
pulling client `.ts` into server tsc compilation) is gone after the
import-retarget. Drift-guard test catches any future re-introduction
of that root cause. No `.gitignore` rule needed — adding one would
mask future legitimate `.js`/`.d.ts` files that someone might author
under `client/src/types/` (today there are none, but future
hand-written declarations are valid).

### Doc / convention updates

- `CLAUDE.md` DO-NOT regression guard #7 (TSC baseline) — rewrite to
  reference ADR-080 and describe the duplicated-types architecture.
  Specifically: server owns wire-shape mirrors under `server/src/types/`;
  drift-guard test prevents cross-package imports.
- `.shipwright/agent_docs/conventions.md` line 12 — same rewrite.
  Also DO-NOT regression guard #7 in conventions.md (line ~65 — search
  for "TSC baseline" — same wording as CLAUDE.md, must stay in sync).

## Files

| File | Op | LOC delta (approx) |
|---|---|---|
| `server/package.json` | Edit (devDep add, version-pinned) | +1 |
| `server/package-lock.json` | Edit (npm-managed) | ~+30 |
| `server/src/types/task.ts` | New | ~40 |
| `server/src/types/settings.ts` | New | ~15 |
| `server/src/types/project.ts` | New | ~50 |
| `server/src/core/project-manager.ts` | Edit (1 import) | ±0 |
| `server/src/routes/settings.ts` | Edit (1 import) | ±0 |
| `server/src/test/no-cross-package-imports.test.ts` | New | ~50 |
| `server/tsconfig.json` | Edit (drop unused `@shared/*` path alias) | -3 |
| `server/vitest.config.ts` | Edit (drop unused `@shared` alias) | -1 |
| `client/src/types/{project,settings,task}.{js,d.ts,d.ts.map,js.map}` | Delete | -12 files (untracked) |
| `CLAUDE.md` | Edit (DO-NOT #7 retire) | ~+3/-3 |
| `.shipwright/agent_docs/conventions.md` | Edit (line 12 + DO-NOT #7) | ~+6/-6 |

Total: 4 new code files, 6 edits, 12 deletions, 1 ADR.

### Repo-wide sweep findings (per OpenAI review #9, performed pre-implementation)

`git grep -E "(\.\./)+client/" -- ':!*.lock'` returned 6 hits across the
whole repo:

| Hit | Type | Action |
|---|---|---|
| `server/src/core/project-manager.ts:3` | TS import | Retarget (planned) |
| `server/src/routes/settings.ts:2` | TS import | Retarget (planned) |
| `server/vitest.config.ts:11` | Vitest path alias `@shared` | DELETE (unused, latent footgun) |
| `server/tsconfig.json:17` | TS path alias `@shared/*` | DELETE (unused, latent footgun) |
| `server/src/config.ts:65` | Runtime `path.resolve(__dirname, "../../client/dist")` | KEEP (static-file-serving, legitimate) |
| `server/src/types/action-schema-sync.test.ts:64` | Test file fs.readFileSync of client path | KEEP (the EXISTING parity-check pattern that this iterate validates and extends) |

The `action-schema-sync.test.ts` finding is load-bearing: the codebase
ALREADY uses a fs-readFileSync-based parity test as drift-protection
between client and server type files. ADR-080 cites this as
precedent. The drift-guard regex correctly does NOT flag fs operations
or runtime `path.resolve` strings (only `import` / `export ... from` /
dynamic `import()` constructs).

## Test Strategy

### Author-time

1. **AC-3 RED.** Before mirroring/retargeting imports, write
   `no-cross-package-imports.test.ts`. Run server unit tests. The test
   MUST fail because `project-manager.ts` and `routes/settings.ts` still
   contain the offending pattern.
2. **AC-3 GREEN.** Mirror types + retarget imports. Re-run vitest. Test
   MUST now pass. Confirms the test is non-trivial (would catch
   regression).
3. **Repo-wide cross-package sweep** (OpenAI review #9). `git grep -E
   "(\.\./)+client/" -- ':!*.lock' ':!CHANGELOG-unreleased.d/'` from the
   repo root. Document any findings. Expected: zero hits in code paths
   after the retargeting; documentation references in CHANGELOG /
   ADRs are acceptable.
4. **AC-1 GREEN.** Run `cd server && npm run build`. Exit code MUST be 0.
5. **AC-2 GREEN — MANDATORY.** Run
   `node -e "require('fs').accessSync('dist/index.js')"` from `server/`.
   Promoted from "optional cheap" to mandatory per OpenAI review #6.
6. **AC-4 GREEN.** `git status` shows no `client/src/types/*.{js,d.ts,...}`
   entries.
7. **AC-5 GREEN.** `grep -n "TSC baseline" CLAUDE.md .shipwright/agent_docs/conventions.md`
   returns 0 hits for the OLD wording, > 0 for the NEW (post-ADR-080) wording.

### Type-purity verification (Gemini review #2)

Before committing the mirrored files, verify each contains ONLY type
aliases / interfaces / string-literal unions (no enums, classes, const
assertions producing values, or default-exported runtime values).
This guarantees `tsc` emits empty `.js` files for them in `dist/types/`
(or no emit if `isolatedModules` is configured) — no duplicate runtime
logic. The current client files satisfy this (verified by reading
`client/src/types/{task,settings,project}.ts` — all `export type` /
`export interface` only, plus a single string-literal union). Mirror
verbatim per OpenAI review #7 — no clean-up edits during the move.

### F0.5 (production-time chokepoint)

- **Surface:** `cli`
- **Runner:** `cd server && npm run build` invoked via
  `surface_verification.py`. Exit 0 = AC-1 + AC-2 simultaneously
  (build success implies dist/index.js produced).

### Risk-flag enforcement

`touches_build` (server `package.json`) — formal trigger for the
performance-budget layer. Skip with justification: server-only change,
no Vite bundle impact, no `dev_url` for Lighthouse. Skip recorded in
`shipwright_test_results.json.iterate_latest.degraded`.

## Alternative Considered

**TypeScript Project References.** Rejected for this iterate (own
section in spec under "Out of Scope"). Documented in ADR-080 as the
escalation path if shared surface grows beyond the 3 type files.

**Keep cross-package imports + relax `rootDir`.** Either remove
`rootDir` (breaks `outDir` layout — `node dist/index.js` would no longer
find the entry point) or use `rootDirs` array (does NOT relax the
rootDir constraint, only changes virtual-root-merging for output).
Neither cleanly solves the problem.

## Risk Notes

- **Drift between client and server type copies.** Mitigated by
  drift-guard test (cross-package imports impossible) + headers naming
  canonical origin. Real drift surfaces as compile error elsewhere
  (consumer field doesn't exist) or runtime contract violation (server
  emits a field client doesn't know about — non-breaking by JSON
  conventions).
- **`@types/proper-lockfile` API drift vs runtime package.** Both are
  community-maintained. Risk is symmetric to existing `@types/shell-quote`
  + `@types/node` story; same DefinitelyTyped review process.
- **Parallel iterate (v0.8.9) racing on shared finalization artifacts.**
  Session-role marker is `secondary`; F11 push is gated by
  `SHIPWRIGHT_SECONDARY_PUSH_AUTH=1` (per parallel-iterate guard,
  ADR conventions, B1c).
