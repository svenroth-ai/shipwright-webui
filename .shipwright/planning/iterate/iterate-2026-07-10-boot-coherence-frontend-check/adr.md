# Iterate ADR — iterate-2026-07-10-boot-coherence-frontend-check (D23)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D23 (LAST of 23) ·
Complexity: medium (orchestrator override of a keyword-driven `large` false
positive; classifier returned `small` + risk flag `touches_io_boundary`,
enforcement `round_trip_test`) · Type: bug (spec_impact: none). Findings: F32
(LOW). Depends on: D19 (snapshot-tmp-sweep, merged).

## Change summary
The boot-time preview-capability coherence check (`server/src/index.ts`
§ "Section 03", inside the `if (isMainModule)` boot IIFE) computed
`hasFrontend = Boolean(prof.stack?.frontend)`. `Boolean({})` is `true`, so the
bundled python-plugin-monorepo profile — which intentionally ships
`"stack": { "frontend": {} }` with `"dev_server": null` (backend-only by
design) — was classified as "frontend declared". With no `dev_server.command`,
the `hasFrontend && !hasDevServer` branch fired, logging a spurious "preview
button will stay hidden" warning on EVERY boot for backend-only projects (F32,
LOW/noise).

- `server/src/core/preview-coherence.ts` — NEW cohesive module (86 LOC), two
  PURE functions:
  - `profileDeclaresFrontend(frontend: unknown): boolean` — the fixed predicate.
    `null`/`undefined` → false; non-object → `Boolean(value)` (pre-fix
    semantics preserved, so only the empty-object case narrows); object →
    `Object.keys(value).length > 0` (empty `{}`/`[]` → false). The
    `typeof === "object"` guard is TypeError-safe for any stray primitive.
  - `evaluatePreviewCoherence(projectId, profile, prof)` — pure warn matrix
    (plan § 2.1). Returns the warn envelope (byte-identical to the two prior
    inline messages) or `null` when coherent, incl. the backend-only stack.
- `server/src/index.ts` — § "Section 03" now iterates projects and calls
  `evaluatePreviewCoherence` per resolved profile, owning the `console.warn`
  side effect. The two verbose inline warn blocks are deleted. Held at 877 LOC
  (baseline 899 — NOT ratcheted; net −20 vs pre-iterate 897).
- `server/src/core/preview-coherence.test.ts` — NEW regression file (90 LOC,
  < 300): AC2 RED-first F32 pin (`frontend:{}` + `dev_server:null` → no warn),
  the `dev_server:undefined` twin, the two still-warn regression pins
  (populated frontend without dev_server; dev_server without frontend per
  ADR-036), the fully-wired no-warn case, the no-`stack`-key case, plus the
  predicate quadrants (empty/populated object, null/undefined, non-object
  truthiness, empty/non-empty array).

`external/actions/get.ts:99` carries the same `Boolean(profile?.stack?.frontend)`
idiom but is NOT touched: it is out of the parallel-safety footprint, and the
bug is already masked there by `&& dev_server.command` — for python-plugin-
monorepo (`dev_server: null`) the PreviewButton is hidden regardless, so there
is no user-visible defect. Documented no-op (external-review disposition below).

### Footprint deviation (AC4) — recorded
The spec footprint listed `server/src/index.ts` + `server/src/index.test.ts`.
The fix lives instead in a NEW module + NEW colocated test; `index.test.ts` is
NOT touched. Rationale (same disposition as sibling D19): (1) the coherence
check runs inside the `isMainModule` boot IIFE, which Vitest never executes — an
inline change is structurally UNCOVERABLE, so AC2's RED-first test and the HARD
diff-coverage gate (≥80%) cannot be met from `index.test.ts`; (2) an exported
predicate added to `index.ts` would GROW it past its 899 grandfathered bloat
baseline (HARD anti-ratchet gate). A pure module is testable AND shrinks
index.ts (897 → 877). The brief explicitly sanctions "put new coherence-check
logic in a new cohesive file … not inline in index.ts if it would ratchet". The
footprint contract's sole purpose is parallel-collision avoidance; D23 is the
LAST serial unit (all D01–D22 merged), so collision risk is nil. New files are
discovered by the vitest `**/*.test.ts` glob (verified: 11 tests ran).

## Self-Review (7-item)
1. Spec Compliance — PASS. Empty-`{}` frontend is now backend-only; F32's
   spurious warning no longer reproduces (AC1). AC2 RED-first proven twice
   (predicate + matrix RED against `Boolean(...)`). AC3 full server suite (2029)
   + build green. AC4 footprint deviation recorded above (baseline-forced).
2. Error Handling — PASS. The boot try/catch around the loop is unchanged
   (non-fatal diagnostic). The predicate never throws (null-guard +
   typeof-guard before `Object.keys`). `evaluatePreviewCoherence` is total.
3. Security Basics — PASS. Read-only over bundled profile JSON via the existing
   `loadProfileReal` loader; writes nothing (read-only-observer rules 1/12 —
   never `~/.claude/projects/**` or run_config). Warn output format is byte-
   identical (no new logged fields).
4. Test Quality — PASS. RED-first behaviorally demonstrated (git-stash-free:
   predicate reverted to `Boolean(...)` → `4 failed`, incl. the F32 matrix pin
   "expected {level:'warn'} to be null"); real-profile round-trip probe run
   (Calibration below); the exact audit shape `dev_server: null` pinned.
5. Performance Basics — PASS. One `Object.keys` per project at boot only; no
   hot-path, no timer, no new I/O (reuses the already-cached profile loader).
6. Naming & Structure — PASS. `profileDeclaresFrontend` /
   `evaluatePreviewCoherence` descriptive; control flow < 3 levels; no dead
   code; no baseline ratchet (877 ≤ 899; new files < 300; profile-loader
   untouched). Boot-driver + injected-logger abstraction removed after review
   (Simplicity-First).
7. Affected Boundaries (ADR-024) — PASS. Producer = bundled profile JSON on
   disk (`stack.frontend`, `dev_server`); consumer = `evaluatePreviewCoherence`
   via `loadProfileReal`. Real round-trip probe run through the production
   loader over all three bundled profiles (Calibration below).

## External Plan Review (Step 3.5, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G-1/O-1/O-4 | HIGH/MED | Over-production: a 120-LOC module with a "boot driver" + injected logger + "warn envelope" is overkill for a one-predicate fix (Simplicity-First / single-caller helper) | accepted-and-fixed. Dropped `logPreviewCoherenceWarnings` (the boot driver) + the injected `logger`. Module now exports only two PURE functions; index.ts owns the loop + `console.warn` — exactly openai #4's recommended shape. Module 120 → 86 LOC. |
| G-2/O-1(footprint) | HIGH/MED | New files violate the 2-file footprint / AC4 (parallel-safety) | accepted-with-reason. Baseline-forced (index.ts at 899 anti-ratchet HARD gate) + coverage-forced (boot IIFE uncoverable) + brief-sanctioned ("new cohesive file") + parallel-safe (D23 is the LAST serial unit; D01–D22 merged). D19 precedent. Recorded under "Footprint deviation". |
| O-2 | MED | Predicate broadens semantics beyond the defect (non-object truthy, empty array) | accepted-and-fixed-partly / rejected-rest. The fix NARROWS only the empty-object case; non-object values KEEP the pre-fix `Boolean(...)` result (documented + pinned by a test), so no supported profile shape changes behavior. Empty-array → false is the same "empty means backend-only" rule (consistent, pinned). |
| O-3/G-3 | MED | Encode the exact warn matrix in tests before refactoring; verify test seams | accepted-and-fixed. `evaluatePreviewCoherence` tests cover all four quadrants + no-`stack`-key; the `isMainModule` seam was confirmed (grep: boot block guarded, never run under Vitest). |
| G-4/O-6 | LOW | `Object.keys` edge-cases on non-plain objects / primitive TypeError | accepted-verified. Profile JSON yields plain objects; the `typeof === "object"` guard prevents any primitive TypeError (gemini concedes it "is adequate and safe"). |
| O-5 | LOW | Prerequisite claim ("Vitest never runs the IIFE") asserted without checking seams | accepted-verified. Confirmed by source: the coherence block is inside `if (isMainModule) { void (async () => {…})(); }`; `index.test.ts` imports `app` without booting. |
| O-7 | LOW | Reusable module + logged strings could invite future misuse | accepted-verified. Functions are pure, no file/network access; log format unchanged. |
| O-8 | LOW | Drop the adjacent `get.ts` analysis from the patch | accepted. `get.ts` untouched; kept as a one-line documented no-op only. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED | The F32 regression test used `dev_server: undefined`, but the audit's exact reported shape is `dev_server: null` — the precise defect was unpinned | accepted-and-fixed. Widened `PreviewCoherenceProfile.dev_server` to `| null` (the bundled backend-only profiles ship literal `"dev_server": null`); the F32 test now pins `{ frontend:{}, dev_server:null }` exactly, with the `undefined` twin kept as a second case. |
| 2 | HIGH/MED | New files violate the footprint / AC4 | accepted-with-reason (identical to plan G-2; baseline-forced, brief-sanctioned, parallel-safe, D19 precedent). |

Gemini's code-review stream truncated mid-second-finding (an artifact); the
readable portion raised only the footprint HIGH (already dispositioned).

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(the campaign orchestrator runs `spec-reviewer → code-reviewer` over the pushed
diff before merge; the runner has no Agent tool).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: bundled profile JSON on disk — producer = the profile files'
`stack.frontend` + `dev_server` fields; consumer = `evaluatePreviewCoherence`
via the production `loadProfile` loader.
Probes run:
1. RED-first behavioral probe: predicate reverted to `return Boolean(frontend)`
   → `4 failed`, incl. the F32 matrix pin ("expected {level:'warn'} to be
   null") and the empty-`{}` predicate pin ("expected true to be false").
   Restored → 11 pass.
2. Real-disk field probe: parsed all three bundled profiles directly —
   `python-plugin-monorepo` = `frontend:{}` + `dev_server:null` (the F32 shape,
   confirmed on disk); `supabase-nextjs` = populated frontend + `dev_server.
   command`; `vite-hono` = populated frontend + `dev_server:undefined`.
3. Real round-trip probe (production loader + evaluator over the real profiles
   dir): python-plugin-monorepo → NO warn (F32 fixed); supabase-nextjs → NO
   warn (coherent); vite-hono → WARN "declares stack.frontend but no
   dev_server.command" (regression pin — a genuinely-misconfigured profile
   still warns). Matches the unit-test matrix exactly.
Findings: probe 1 reproduced the F32 defect (RED), fixed. Probes 2–3 found NO
further issues → two consecutive clean probe rounds → asymptote reached,
boundary calibrated.
Edge cases not probed + why acceptable: `stack: null` / no `stack` key
(covered by a unit test → no warn); `dev_server: {}` with no `command`
(`Boolean(undefined)` → treated as no dev_server, correct); a profile shipping
`stack.frontend` as a non-object string (legacy shape not present in any
bundled profile; predicate preserves the pre-fix `Boolean` result — no behavior
change).

## Reviews summary (result-JSON contract)
- plan: completed (openrouter, 8 findings dispositioned)
- self_review: completed (7/7 pass, 0 failed)
- code: delegated_to_orchestrator
- external_code: completed (openrouter, 2 findings dispositioned)
- confidence_calibration: completed (3 probes, 1 with findings, asymptote reached)
