# Iterate ADR — iterate-2026-07-10-task-title-validation (D22)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D22 · Complexity: medium
(orchestrator override of a keyword-driven `large`/`touches_io_boundary` false
positive from verbose prose) · Type: bug (spec_impact: none). Findings: F27
(LOW, bug).

## Change summary
- `_shared/helpers.ts` — new exported `normalizeTitle(raw)` returning
  `{ ok:true, value } | { ok:false, error }`, extracted verbatim from PATCH's
  inline title validation (identical three error strings). Single source of
  truth; mirrors the established `normalizeDescription` create/PATCH-parity
  sibling. Reject rule = `/[\r\n]/` (CR, LF, CRLF) → "title cannot contain
  newlines"; empty-after-trim → "title cannot be empty"; > TITLE_MAX_LENGTH →
  "title exceeds N characters".
- `patch.ts` — title block refactored to call `normalizeTitle` (net −11 LOC,
  no behavior change; identical error envelope, locked by existing PATCH tests).
- `create.ts` — a PROVIDED (non-blank) title is now validated via the helper
  → `{error}` 400 before persistence. An ABSENT / whitespace-only title keeps
  the "Untitled task" default affordance (Chesterton's fence — quick-add).
- `lifecycle.ts` (fork) — validates a PROVIDED title via the helper BEFORE
  `store.create`, so an invalid title is rejected up-front with NO orphan child
  row (pre-fix: `normalizeTitle` threw inside `buildCopyCommands` AFTER
  `store.create` → 500 + orphan). Absent/blank keeps the "<parent> — fork"
  default. D01 DELETE/kill lifecycle wiring untouched.
- New `tasks/__tests__/title-validation.test.ts` (231 LOC) — create + fork +
  PATCH-parity coverage; AC2 RED-first on newline (LF/CR/CRLF) + over-length.

## Deliberate scope decisions
- Empty title is NOT rejected at create/fork (unlike PATCH): the synthesized
  default is a load-bearing affordance (client `createTask` inline quick-add /
  `forkTask({})` no-title path) and an empty title never breaks launch
  (launcher `normalizeTitle` returns undefined for empty → no `--name`). Only
  newline + over-length are the actual PATCH-parity violations, and newline is
  the actual launch-breaking bug.
- Footprint deviation: spec footprint named create.ts + lifecycle.ts +
  routes.test.ts. Added `_shared/helpers.ts` + `patch.ts` to reuse PATCH's
  validation as a single source of truth per the task's explicit "reuse the
  existing PATCH validation, don't duplicate a divergent one". Used a new
  cohesive `title-validation.test.ts` instead of routes.test.ts (298 LOC → a
  new test there crosses the 300 bloat ceiling = audit H1 HIGH). Parallel-
  safety is moot — D22 is serial #22/23, all deps merged, blocks nothing.

## Self-Review (7-item)
1. Spec Compliance — PASS. Create + fork now reject the same invalid titles
   PATCH does (newlines/over-length) with identical error strings; fork
   validates before child creation (no orphan). Matches the Fix direction.
2. Error Handling — PASS. All three routes return the identical `{error}` 400
   envelope via `c.json`. Fork's pre-create guard removes the uncaught
   `normalizeTitle` throw → no more 500. Non-string/absent handled explicitly.
3. Security Basics — PASS. No new auth/secrets. Rejecting CR/LF at the write
   boundary hardens the `--name` single-line command surface against injection
   of extra shell lines via a persisted title. No path handling changed.
4. Test Quality — PASS. AC2 proven RED on pre-fix (create newline+over-length;
   fork newline 500+orphan; fork over-length persisted) then green; CR/LF/CRLF
   parameterized; "no orphan row" asserted via store.list(); happy-path fork
   asserts `commands` emitted (buildCopyCommands non-regression).
5. Performance Basics — PASS. One regex + trim per create/fork/patch call; no
   loops, no I/O added. patch.ts shrank.
6. Naming & Structure — PASS. `normalizeTitle` matches the launcher +
   `normalizeDescription` convention; control flow < 3 levels; no dead code.
   All touched files < 300 LOC (create 179 / lifecycle 253 / patch 224 /
   helpers 245 / test 231); no baseline ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = create/fork/patch routes;
   consumers = SdkSessionsStore.persist → sdk-sessions.json (serialized title)
   + launcher buildCopyCommands (`--name`). Real round-trip probe run (see
   Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini) — 5 hi/med merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | HIGH | Create/fork don't fully match PATCH — blank defaults instead of rejecting → contract mismatch | accepted-as-documented-exception. Rejecting blank would regress the "Untitled task"/"— fork" quick-add affordance; empty never breaks launch. Kept + documented; tests prove omitted/blank vs provided-invalid separately. |
| B | HIGH | Footprint/AC4 violation; prefer reusing launcher `normalizeTitle` | rejected-with-reason. Launcher `normalizeTitle` is DIVERGENT (throws, no length check, private) → would violate the task's explicit "same error PATCH gives" + "don't duplicate a divergent one". Extraction from PATCH is the correct single-source-of-truth. Deviation documented; parallel-safety moot (last serial iterate). |
| C | MED | Test only `\n`; rule is CR/LF — cover `\r` + `\r\n` | accepted-and-fixed. Added parameterized CR + CRLF create cases + a CRLF fork case. |
| D | MED | "Same error shape as PATCH" = status + body keys, not just message | rejected-with-reason. Envelope is byte-identical (`{error:<string>}`, 400) — all three call `c.json({error:r.error},400)`; tests assert status + body.error. |
| E | MED | Full input matrix (null/""/"   "/non-string) | accepted-partially. Covered valid, whitespace-default, newline, over-length; non-string/absent → default (create) or "cannot contain newlines" (patch, preserved). CR/CRLF added. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED | New title-validation.test.ts violates the routes.test.ts footprint (AC4) | rejected-with-reason. routes.test.ts at 298 LOC → adding tests crosses the 300 ceiling = new bloat crossing (audit H1 HIGH). Campaign guardrail explicitly sanctions a "new cohesive *.test.ts if needed"; same `__tests__` dir. Bloat ceiling wins the contract conflict. |
| 2 | MED | Exported `normalizeTitle` (strict blank/non-string reject) vs create/fork defaulting → two semantics behind one name | rejected-with-reason. The strict contract IS PATCH's contract (the single source of truth requested). Docstring explicitly states create/fork guard for absent/blank before calling. Mirrors the `normalizeDescription` precedent. Renaming would obscure PATCH-parity intent. |
| 3 | LOW | Valid-title tests don't prove launch/resume non-regression | accepted-and-fixed. Fork valid-title test now asserts `commands` is emitted — the exact buildCopyCommands path that 500s on an invalid title. Full launch chain covered by the green routes.launch-* / phase-task-launch suites. |
| (gemini) | — | Already-persisted bad titles still 500 on launch | rejected-with-reason (out of scope). F27 is preventive (reject at write, per the Fix direction). Retroactive sanitize / launch-path try/catch is a separate concern + footprint — noted as a triage follow-up candidate. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs a code-reviewer subagent over the pushed diff before merge).

## Confidence Calibration (Step 3.8, medium + touches_io_boundary flag)
Boundary: create/fork/patch route (producer) → SdkSessionsStore.persist →
sdk-sessions.json (serialized `title`) → reload (consumer) + buildCopyCommands
`--name` (consumer).
Probes run:
1. Unit round-trips (committed): create/fork newline (LF/CR/CRLF) → 400 + zero
   rows; over-length → 400 + zero rows; valid → trimmed + stored; blank → default;
   fork valid → `commands` emitted; PATCH helper parity (newline + over-length).
2. THROWAWAY real-fs round-trip probe (run, then deleted): valid Unicode +
   surrounding-whitespace title → real disk persist → reload → title
   byte-identical (trimmed), disk JSON carries NO newline in the title field;
   invalid newline title → 400 → reloaded store still exactly 1 row (no orphan)
   → disk never contained the newline title. All 8 checks PASS.
Findings: probe set 1 found the pre-fix bugs (RED), all fixed. Probe set 2
(CR/CRLF + real-fs round-trip + happy-path commands) found NO further issues →
two consecutive clean probe rounds → asymptote reached, boundary calibrated.
Edge cases not probed + why acceptable: already-persisted legacy bad titles
(out of F27's preventive scope — triage candidate); ELOCKED-during-fork-persist
orphan (pre-existing, unrelated to title validation, out of footprint — after
pre-create validation buildCopyCommands no longer throws, closing the F27 path).
