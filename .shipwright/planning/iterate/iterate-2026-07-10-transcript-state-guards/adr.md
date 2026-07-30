# Iterate ADR — iterate-2026-07-10-transcript-state-guards (D06)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D06 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive) · Type: bug
(spec_impact: none). Findings: F04 (MEDIUM), F23 (LOW), F24 (LOW).

## Change summary
- `transcript/routes.ts` — `isTerminalState = done|launch_failed`. Missing-branch:
  terminal states never flip to `jsonl_missing`. Ok-branch: terminal states are
  fully immutable (no state transition, no firstJsonlObservedAt backfill, no
  mtime write). Widened the resurrection guard so a closed row with no
  `firstJsonlObservedAt` is never yanked to `active`. Dirty-check: the
  `lastJsonlSeenMtimeMs` patch is only built when the mtime moved, and
  `store.patch`+`persist` fire only when the patch is non-empty.
- `session-watcher.ts findByUuid` — the subdir `stat`, subdir `readdir`, and the
  matched-file `stat` now go through `readWithRetry`; the top-level
  `readdir(projectsDir)` too but with `ENOENT_FATAL` (ENOENT = dir genuinely
  absent = authoritative empty, fast-fail; EBUSY/EPERM/EACCES retry). Added an
  optional `fatalCodes` param to `readWithRetry` so the readFile torn-read path
  keeps retrying ENOENT while discovery treats absence as authoritative.

## Self-Review (7-item)
1. Spec Compliance — PASS. Terminal states immutable in both branches; closed
   task never resurrected; dirty-checked persist; findByUuid discovery wrapped
   in the retry envelope. Matches the spec Fix direction exactly.
2. Error Handling — PASS. `readWithRetry` still rethrows after budget; each
   discovery try/catch degrades to continue/null as before; ENOENT fast-fail
   preserves the legit-empty semantics.
3. Security Basics — PASS. No new inputs, auth, or secrets; retry set unchanged
   (the 4 justified fs codes); no path handling changed (read-only observer).
4. Test Quality — PASS. AC2 proven RED on pre-fix (5 tests) then green; no-op
   polls assert BOTH zero patch and zero persist; terminal cases parameterized
   over done + launch_failed; EBUSY retry asserts the retry actually fired.
5. Performance Basics — PASS. Dirty-check REMOVES a per-second full-store
   JSON.stringify for idle/terminal tasks (F23). Retry adds cost only on a real
   transient error; ENOENT fast-fail keeps the empty-dir path at zero backoff.
6. Naming & Structure — PASS. `isTerminalState`, `ENOENT_FATAL`, `fatalCodes`
   are descriptive; control flow < 3 levels; no dead code. session-watcher.ts
   held at 299 LOC (< 300, no new bloat crossing); no baseline ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = transcript route +
   findByUuid; consumer = SdkSessionsStore persist (sdk-sessions.json) +
   client transcript render. Real round-trip probe run (see Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini) — 2 medium merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | MED | Terminal tasks skip mtime bookkeeping → claimed transcript truncation | accepted-then-superseded. Initially kept mtime for terminal; the code review + spec-literal "immutable from poll results" reversed it. VERIFIED the premise is false: the transcript chunk is byte-offset driven (read live every poll), NOT gated on `lastJsonlSeenMtimeMs`, so full immutability never truncates. Board shows live mtime (ADR-102) regardless. → fully immutable. |
| B | MED | Top-level `readdir(projectsDir)` left unwrapped → transient EBUSY still an authoritative miss | accepted-and-fixed. Wrapped in `readWithRetry` with `ENOENT_FATAL` so EBUSY/EPERM/EACCES retry while the legit "no projects dir yet" ENOENT stays fast (no 3 s backoff, no test-suite slowdown). |
| (low) | LOW | findManyByUuid excluded | rejected-with-reason. Out of the F24 footprint; findManyByUuid feeds the board's LIVE mtime display but never PERSISTS a state transition (only the findByUuid poll path persists), so a transient miss there self-heals next poll with no persisted flip. Wrapping it would also breach the 300-LOC ceiling on this non-baselined file. Noted as a triage follow-up candidate. |
| (low) | LOW | mtime NaN/normalization | rejected-with-reason. `loc.mtimeMs` is always a finite fs.stat value; `?? 0` guards null-loc. Exact float equality is the intended same-stat check. |
| (low) | LOW | symmetric launch_failed coverage | accepted-and-fixed. Terminal tests parameterized over done + launch_failed in both branches. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED | Ok-branch terminal still mutated mtime — contradicts spec "immutable" | accepted-and-fixed. Restored `!isTerminalState` on the dirty-check → terminal rows do zero patch/persist. |
| 2 | MED | AC asks to re-run newplain idle/active + Playwright 38 | accepted. The two newplain regression suites are re-run GREEN unchanged (behavior for draft/active/idle preserved). Playwright 38 addressed via the F0.5 surface decision (below). |
| 3 | LOW | missing-branch test only checks in-memory, not reload | accepted-and-fixed via patch-spy (zero patch proves no in-memory mutation) + a real-disk reload probe (Calibration). |
| 4 | LOW | dirty-check test should assert patch skipped too | accepted-and-fixed. Added `spyPatch`; no-op polls now assert zero patch AND zero persist. |
| (gemini) | — | firstJsonlObservedAt never set for a terminal task — intended? | confirmed-intended. That field drives the draft→active first-observation transition, meaningless for a terminal row; leaving it unset is correct under full immutability. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs a code-reviewer subagent over the pushed diff before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: JSONL filesystem discovery (findByUuid) + sdk-sessions.json persist
round-trip (poll→patch→persist→reload).
Probes run:
1. Poll→patch→persist unit round-trips (committed): done/launch_failed missing →
   zero patch+persist; ok-branch terminal → zero patch+persist; unchanged mtime →
   zero patch+persist across repeated polls; state transitions still persist.
2. findByUuid one-shot EBUSY file stat (committed) → retries, resolves.
3. THROWAWAY real-fs probe (run, then deleted): `done` task + deleted JSONL,
   3 polls → store file byte-IDENTICAL before/after AND a freshly reloaded
   store reads `state=done`. Real-watcher EBUSY-then-ok stat → resolves (2 calls).
Findings: probe set 1 found the pre-fix bugs (RED), all fixed. Probes 2 + 3
found NO further issues → two consecutive clean probe rounds → asymptote reached,
boundary calibrated.
Edge cases not probed + why acceptable: persistent EPERM exhaustion (covered by
existing readWithRetry rethrow tests → surfaces as a normal "missing", correct
for a genuinely inaccessible dir); findManyByUuid (does not persist state — see
plan-review disposition).
