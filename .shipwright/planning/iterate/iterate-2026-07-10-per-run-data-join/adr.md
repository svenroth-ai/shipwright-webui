# ADR — A02 per-run data join (iterate-2026-07-10-per-run-data-join)

- **Run ID:** iterate-2026-07-10-per-run-data-join
- **Campaign:** webui-wow-usability-2026-07-10 · sub-iterate A02
- **FR:** FR-01.47 (Per-run data join — runId → FRs/tests/derived-gates/phase-timings + grade-trend)
- **Complexity:** medium · risk flags: touches_io_boundary, touches_public_api, touches_shared_infra
- **Change type:** feature · spec_impact: add (FR-01.47 table row)

## Decision

Add `core/run-data-join.ts` (+ `run-data-types.ts` shape contract) that consumes
A01's `event-log-reader.ts` and projects each `work_completed` run into the
per-run shape the WOW UI renders, plus a grade-trend fold from `grade_snapshot`
events. Expose three read-only endpoints (`/runs`, `/runs/:runId`,
`/grade-trend`) via `external/runs/routes.ts`, and client `lib/runDataApi.ts` +
`hooks/useRunData.ts`. Honest degradation is structural: durations are never
fabricated (per-run only from `phase_timings`; pipeline transitions aggregated at
project level by `(phase, splitId)`, never pinned to a run); gates are DERIVED and
flagged `derived: true`.

## Join-key contract (highest campaign risk)

`task.runId == adr_id` — the documented contract, pinned at the CONSUMER (the
board card / Mission-Control chip passes `task.runId` as the `runId` query param;
the server returns the `work_completed` whose `adr_id` equals it). Miss-cases
tested: task with no runId (`readRunDetail(root,"")` → null), runId with no
matching event (→ null), and an explicit equality test proving a sibling run's
FRs/tests never leak. Degrades cleanly, never guesses.

## Honesty invariants (spec AC3 / AC5)

- Per-run `phaseDurations` comes ONLY from that run's own `phase_timings`; absent
  → `null` (render **n/a**). The pipeline `phase_started`/`phase_completed`
  aggregation is PROJECT-level (`pipelinePhaseDurations`) because those events
  carry no run key — attributing the whole array to one run would mis-attribute
  or drop durations (upstream note from A01's review). No duration is ever
  synthesized/interpolated/estimated/back-filled; negative intervals → null.
- Gate lamps flagged `derived: true`; only `test` carries a real per-run signal;
  `review`/`security` are honestly `"unknown"` (no per-run signal in the event
  log). Never presented as an authoritative verdict.
- Current grade is NOT re-derived — `compliance-reader.ts` owns it; this iterate
  adds only the trend.

## External-Plan-Review-Findings (openrouter — gemini + openai, 15 findings)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G1 | High | Grade trend as "pure join over projectEventLog" would be empty (A01 skips grade_snapshot) | accepted-and-already-implemented — `projectGradeTrend(lines)` reads the RAW lines directly; `projectRunData` reads the file ONCE and passes the same lines to both projections (no 2nd disk read). Plan wording was imprecise; code is correct. |
| G2 | High | Pipeline durations "never pinned to a run" breaks per-run viz; temporally bind to run | rejected-with-reason — spec upstream note explicitly forbids attributing the transition array to one run (no run key); temporal binding across interleaved runs is the "guessing" AC2 forbids. Per-run ITERATE durations DO populate per-run from `phase_timings` (reviewer missed this) — not permanently n/a. |
| G3 | Med | Add strict hex regex on `:runId` before reader | rejected-with-reason — runId is an in-memory FILTER key, never a path segment (EVENT_FILE is constant, pathGuard covers it). Real runIds are `iterate-YYYY-MM-DD-slug`, NOT hex — a hex gate would reject every real id. Unknown/malformed → graceful 200 `{run:null}`. |
| G4/O11 | Low | `run-data-types.ts` is needless abstraction | rejected-with-reason — the 300-LOC ceiling is a hard repo convention + bloat anti-ratchet gate (AC7); inlining pushes the join to ~450 → a NEW baseline crossing. A01 set the exact precedent (`event-log-types.ts`). |
| O1 | High | Join doesn't show how affectedFrs/summary/commit join from TASK data | rejected-with-reason — those are EVENT facts (`work_completed`), keyed by adr_id. There is no server-side task-collection join; task binding is the consumer's `runId` query param. This iterate is the event side of the join. |
| O2/O(code)3 | High | Omits `shipwright_test_results.json` ("where present") | rejected-with-reason — it is a single CURRENT-run file with no run key; attributing it to a specific historical runId would be guessing (AC2). Durable per-run source is `work_completed.tests` (finalize writes it at F5b). Not in AC7 footprint. |
| O3 | High | Gate logic narrower than spec (phase_tasks[].status + phase_failed) | rejected-with-reason — `phase_tasks[].status` lives in run_config/run_loop_state, NOT the event log; `phase_failed` events carry no adr_id. Per-run event-log gate signal is limited to the run's own tests; review/security honestly `"unknown"` per AC3. Fabricating from unattributable events violates the honesty contract. |
| O4 | Med | Pipeline aggregation under-specified (pairing, sum vs span, dup/orphan/out-of-order, negative) | accepted-and-fixed — added a negative-interval → null guard; pairing by (phase,splitId), last-end-wins dedup, orphan→null+incomplete, out-of-order via timestamp-diff, sum-of-splits totalMs — all implemented + tested. |
| O5 | Med | How does grade trend get skipped raw events without a 2nd disk read | accepted-and-already-handled — one `readFileSync`, `text.split("\n")` passed to both projections; a 2nd in-memory JSON.parse pass keeps A01's contract frozen (parallel-safety). |
| O6 | Med | Repeated work_completed for same adr_id → nondeterministic | accepted-and-already-handled — A01's `projectEventLog` dedupes by adr_id (latest ts, file-index tiebreak); deterministic. |
| O7 | Med | Routes should inherit project auth/context | rejected-with-reason — local single-user app, loopback CORS; routes use the IDENTICAL `getProjectById` + 404/400 pattern as events/compliance/run-config. No per-tenant model exists to inherit. |
| O8 | Med | "404/400/200" ambiguous vs 200 {run:null} contract | accepted-and-already-covered — distinct tests: 404 unknown project / 400 path-less / 200 {run:null} unknown runId. |
| O9 | Med | Registration-shell mount not in footprint, parallel-edit risk | accepted-and-covered — +4 lines in routes.ts after A01's MERGED events mount (no live conflict); full external/routes.test.ts green. |
| O10 | Low | Client query key must include project identity | accepted-and-already-handled — all three keys include projectId. |

## External-Code-Review-Findings (openrouter — gemini + openai, over the diff)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | Med | Gates: review/security permanently "unknown"; derive from phase_tasks/phase_failed | rejected-with-reason — same as O3; those signals live outside the event log / carry no run key; honest "unknown" + `derived:true` IS the AC3 contract. |
| C2 | Med | Gate tests codify the incomplete behavior; no phase_tasks/phase_failed fixtures | rejected-with-reason — consistent with C1; the "unknown" assertions ARE the honesty guarantee (nothing to derive from unattributable events). |
| C3 | Med | No `shipwright_test_results.json` fixture | rejected-with-reason — same as O2 (no run key; would be guessing; not in footprint). |
| C4 | Low | Join-key test only filters adr_id; doesn't model task.runId equality | accepted-and-fixed — added an explicit `task.runId === adr_id` test (matching + sibling-non-leak + no-match miss). |
| — | — | gemini "binary file diff" for run-data-join.ts | REAL DEFECT caught independently by an empirical probe (see Confidence Calibration) — a stray NUL byte in the `NO_SPLIT` sentinel made git treat the file as binary. FIXED by dropping the sentinel (JS Map keys `null` distinctly). |

## Self-Review (7-item, ADR-029)

1. **Spec Compliance** — PASS. AC1-AC7 met: join returns FRs/tests/derived-gates/
   grade-trend; unknown/absent → null/[]/graceful; honest n/a durations; RED-then-
   green tests; provenance-honest (derived flag, honest empty states); suites green;
   footprint respected, no externalApi.ts wrapper, bloat baseline not ratcheted.
2. **Error Handling** — PASS. Every read is try/caught or pathGuard-gated; absent/
   torn/unreadable → empty bundle or null, never a throw/500; torn lines counted.
3. **Security Basics** — PASS. Read-only observer; pathGuard on the constant
   EVENT_FILE (realpath+relative, DO-NOT #10); runId never a path segment; no write
   surface; same resolver/error posture as sibling read routes.
4. **Test Quality** — PASS. 48 new tests (server 41 + client 10) across present/
   partial/absent/unknown/no-phase_timings/negative-interval/multi-split/join-key/
   graceful; HEX fixtures; RED on pre-A02 main.
5. **Performance Basics** — PASS. One disk read per request; two in-memory passes
   over the same lines; O(n) projection; 30 s client poll (append-per-run, not live).
6. **Naming & Structure** — PASS. Types split (mirrors A01); files ≤300 LOC; router
   in its own subdir like every sibling; verbatim client mirror (ADR-080).
7. **Affected Boundaries** (ADR-024) — PASS. Producer = shipwright emitters
   (`record_event.py` grade_snapshot/phase_*; `finalize_iterate.py` work_completed).
   Consumer = this reader + client hooks. Round-trip probe run: emitter-shaped
   fixtures (grade_snapshot, phase_started/completed with splitId, work_completed
   with phase_timings) → join → asserted shape. Byte-probe of the serialized source
   file caught the NUL defect.

## Confidence Calibration (medium + touches_io_boundary — empirical probes)

Boundaries touched: (a) the `shipwright_events.jsonl` read boundary (producer =
shipwright emitters, consumer = this reader), (b) the HTTP/JSON wire boundary
(server routes → client mirror types).

Probes run:
1. **Round-trip probe** — emitter-shaped JSONL fixtures (grade_snapshot,
   phase_started/completed carrying top-level `splitId`, work_completed with a flat
   `phase_timings` mark-list, torn line) written to disk → `readRunData` →
   asserted the projected shape, dedup, grade-trend order, split aggregation,
   skippedLines. FINDING: none (shape matches emitter output).
2. **Serialized-file byte probe** — scanned the new source files for NUL/BOM/
   encoding + `git diff --numstat`. FINDING: `run-data-join.ts` carried a stray
   NUL byte (a Write-tool artifact in the `NO_SPLIT = " "` sentinel), making git
   treat it as BINARY — invisible to diff/review. FIXED (dropped the sentinel; a
   JS Map keys `null` distinctly). Re-probe: 0 NUL, `git numstat` = `300 0` (text).
3. **Wire-shape probe** — client `runDataApi.test.ts` asserts exact URLs +
   `encodeURIComponent(runId)` + the mirrored envelope shape; hook test asserts
   projectId-in-key + enable-gating + 30 s cadence. FINDING: none.

Asymptote: probe 2 found a bug → fixed → re-probe clean; probes 1 & 3 clean on
first run; two consecutive clean probes post-fix → boundary calibrated.

Edge cases NOT probed + why acceptable:
- Real pipeline `phase_started`/`phase_completed` with real `splitId` from a LIVE
  `/shipwright-run` — 0 such rows exist in any log yet (cross-repo dep). Synthetic
  fixtures cover the aggregation; the reader degrades to `[]`/`null` until real
  data lands (spec explicitly says do not block on it, do not fake it).
- A real folded `work_completed.phase_timings` — 1 such row exists in the monorepo
  (evt-edcf1064); the flat-mark-list fixture matches its documented shape.
