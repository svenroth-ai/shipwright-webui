# Mini-plan — iterate-2026-07-10-boot-coherence-frontend-check (D23)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D23 (LAST of 23) ·
Complexity: medium (orchestrator override of a keyword-driven `large` false
positive; risk flag `touches_io_boundary`) · Type: bug (spec_impact: none).
Findings: F32 (LOW).

## Problem statement
The boot-time preview-capability coherence check (`server/src/index.ts` §
"Section 03", inside the `isMainModule` boot IIFE) computed
`const hasFrontend = Boolean(prof.stack?.frontend)`. `Boolean({})` is `true`,
so the intentionally-empty `stack.frontend: {}` of the bundled
python-plugin-monorepo profile (which pairs it with `dev_server: null` — a
backend-only stack by design) was classified as "frontend declared". With no
`dev_server.command`, the `hasFrontend && !hasDevServer` branch fired, logging
a spurious "preview button will stay hidden" warning on EVERY server boot for
backend-only projects (F32, LOW/noise). The warning implies a misconfiguration
where the profile is in fact coherent.

## Chosen approach
Tighten the frontend-declared predicate so an empty object is treated as
backend-only, and extract the whole coherence matrix into a NEW cohesive,
unit-testable module `server/src/core/preview-coherence.ts`:

1. `profileDeclaresFrontend(frontend: unknown): boolean` — the fixed predicate.
   `null`/`undefined` → false; a non-object truthy value → `Boolean(value)`; an
   object → `Object.keys(value).length > 0` (empty `{}`/`[]` → false).
2. `evaluatePreviewCoherence(projectId, profile, prof)` — pure warn matrix
   (plan § 2.1). Returns the warn envelope or `null` when coherent (incl. the
   backend-only stack). Emits the two existing warn messages verbatim.
3. `logPreviewCoherenceWarnings(projects, loadProfile, logger?)` — the boot
   driver. `logger` is injected (default `console.warn`) so the diagnostic is
   testable without a live server boot. Returns the emitted warnings.

`index.ts` § "Section 03" collapses to a single `logPreviewCoherenceWarnings(…)`
call inside the unchanged try/catch. The two inline `console.warn` blocks are
deleted.

### Alternatives considered
- **Fix the predicate inline in `index.ts`** (spec's literal footprint =
  index.ts + index.test.ts). REJECTED for two reasons: (a) the coherence check
  runs inside the `if (isMainModule)` boot IIFE, which Vitest never executes —
  any inline change is structurally uncoverable, so AC2's RED-first test and the
  hard diff-coverage gate (≥80%) cannot be met from `index.test.ts`; (b) an
  inline non-empty-object predicate GROWS `index.ts` past its 899 grandfathered
  bloat baseline (HARD anti-ratchet gate). A pure module is testable AND shrinks
  index.ts (897 → 871). The brief explicitly sanctions "a new cohesive file or
  the profile/capability module … not inline in index.ts if it would ratchet".
- **Put the predicate in `profile-loader.ts`.** Viable (it is the profile
  module, 156 LOC, unbaselined) but the coherence WARN matrix + boot driver are
  a distinct concern from profile loading/caching; a dedicated
  `preview-coherence.ts` is more cohesive (Single-Responsibility).
- **Also fix `external/actions/get.ts:99`** (`Boolean(profile?.stack?.frontend)`,
  the PreviewButton gate). REJECTED: out of the parallel-safety footprint, and
  the bug is already masked there by the `&& dev_server.command` guard — for the
  python-plugin-monorepo profile (`dev_server: null`) the button is hidden
  regardless, so there is no user-visible defect to fix. Left untouched; noted
  in the ADR as a coherent no-op.

## Invariants preserved
- Read-only-observer (CLAUDE.md rules 1/12): reads only bundled profile JSON via
  the existing `loadProfileReal` loader; writes nothing. No `~/.claude/projects/`
  or run_config access.
- Warn output byte-identical (same two messages, same `{level,message,
  projectId,profile}` envelope) for the cases that SHOULD still warn — regression
  pin kept (populated frontend without dev_server still warns; dev_server without
  frontend still warns per ADR-036).
- Non-fatal contract: the boot try/catch around the call is unchanged.

## Acceptance
- AC1: the F32 spurious-warning scenario (frontend:{}, dev_server:null) no longer
  warns.
- AC2: NEW regression test RED on the pre-fix `Boolean(...)` predicate (empty {}
  classified as declared → warn emitted), green after.
- AC3: full server suite + build green; no invariant/ADR regressed.
- AC4: footprint = new module + new test + index.ts wiring; no baseline ratchet
  (index.ts 871 ≤ 899; new files < 300; profile-loader untouched).

## Files
- `server/src/core/preview-coherence.ts` (NEW, ~120 LOC incl. docs)
- `server/src/core/preview-coherence.test.ts` (NEW, ~120 LOC)
- `server/src/index.ts` (import + collapse § "Section 03" to one call; −26 LOC)
