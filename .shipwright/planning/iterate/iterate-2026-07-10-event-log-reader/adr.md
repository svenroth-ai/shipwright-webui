# Iterate ADR — event-log reader (A01)

- run_id: `iterate-2026-07-10-event-log-reader`
- campaign: `webui-wow-usability-2026-07-10` · sub_iterate_id: **A01** · serial #2 of 22
- change_type: **feature** · FR: **FR-01.46** · complexity: **medium**
  (risk flags: `touches_public_api`, `touches_io_boundary`)
- adr: `iterate-2026-07-10-event-log-reader`

## Decision

Add a read-only, stateless, tolerant reader over a managed project's tracked
event log (`<projectRoot>/shipwright_events.jsonl`) plus a thin read-only
endpoint `GET /api/external/projects/:projectId/events[?runId=]`. This is the
net-new backend the WOW campaign's `reader`-tagged UI (Mission Control Record +
instruments, Ship's-Log runs/sub-scores/last-proof, board per-run facts)
consumes. It is a SIBLING of `core/campaign-events.ts` (which deliberately
projects `commit` only), not a refactor of it.

### Shape
- `core/event-log-reader.ts` — `projectEventLog(lines,{runId?})` (pure) +
  `readEventLog(projectRoot,opts)` (pathGuard-resolved file wrapper, graceful).
- `core/event-log-types.ts` — the JSON shape contract, imported by the reader,
  the route, and both test files (a genuine shared boundary; also keeps every
  file < 300 LOC per the CLAUDE.md rule without a bloat-baseline entry).
- `external/events/routes.ts` — the read-only endpoint (injected reader,
  defaults to the real one), mounted in the `createExternalRoutes` shell
  (+4 lines; routes.ts stays at 278 < 300).

### Honesty invariants (AC2 / AC4)
- `phase_timings` read THROUGH untouched → `null` when absent; NEVER
  synthesized/interpolated/back-filled. Empirically: 0/217 real runs carry it,
  all return `null`.
- Phase transitions read through, file-order, uncollapsed; top-level
  `splitId`/`split_id` untouched; multiple `phase_completed` ends preserved
  (monorepo #369). A02 owns the (phase, splitId) dedup + duration join.
- Only documented fields are projected (explicit field-select, never a raw
  spread) — undocumented emitter fields (`session`, `changed_files`,
  `none_reason`, `backfilled_at`, …) are discarded (bounds exposure).
- `event_amended` / `grade_snapshot` are NOT overlaid — documented; the
  endpoint never claims an amendment-merged view it does not compute.

## Self-Review (7-item)

1. **Spec Compliance** — PASS. AC1 (graceful/no-throw), AC2 (honest null
   durations), AC3 (RED-then-green new tests incl. torn line), AC4
   (provenance-honesty: only genuinely-wired fields served), AC5 (both suites
   green), AC6 (footprint + no baseline ratchet) all met; full spec field list
   projected — the missing `commit` was caught in review and added.
2. **Error Handling** — PASS. Per-line try/catch; absent/unreadable/guarded-out
   log → empty projection; malformed nested field types degrade to null/[]
   (tested). No throw path reaches the route (200 with empty payload).
3. **Security Basics** — PASS. No user-controlled path segment: projectId →
   trusted registry (`getProjectById`) → `project.path` → constant filename;
   `pathGuard` applied defensively. 404 unknown project / 400 path-less. Same
   loopback-CORS posture as compliance/run-config (remote access is a non-goal,
   ADR-067). Read-only — no write surface added (Architecture rule 1).
4. **Test Quality** — PASS. 31 tests: present/bare/malformed fields, torn +
   non-object + no-adr_id lines, dedupe (ts + tie), phase read-through
   (multi-end + splitId + snake_case), runId filter, real on-disk round-trip
   (incl. trailing-newline), + route 404/400/200/query-threading + a
   default-reader filesystem integration test.
5. **Performance Basics** — PASS. Single pass, O(lines); no cache (stateless,
   per CLAUDE.md rule 4 spirit); one `readFileSync` per request (mirrors
   campaign-events; consumers poll at 1 s). No N+1, no unbounded fan-out.
6. **Naming & Structure** — PASS. camelCase JSON contract; helpers named for
   intent (`asString`/`asStringArray`/`asFiniteNumberOrNull`/`projectRun`/
   `projectPhase`); no dead code, no commented-out blocks.
7. **Affected Boundaries (ADR-024)** — PASS. Producer = shipwright-iterate /
   pipeline emitters writing `shipwright_events.jsonl`; consumer = this reader
   (+ A02/A10/A11/A15 downstream). A REAL round-trip probe was run against the
   live 428-line log (see Confidence Calibration), not just fixtures.

## External-Plan-Review-Findings (openrouter: gemini + openai)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| P1 | HIGH | Output contract not enumerated before coding | accepted-and-fixed — enumerated in `event-log-types.ts` against the prototype consumers; the cross-check CAUGHT the missing `commit` field, now added + tested |
| P2 | HIGH | Endpoint authorization / cross-project exposure | rejected-with-reason — webui has no per-project auth (loopback-only; remote access a non-goal, ADR-067); projectId resolves via the trusted registry exactly like compliance/run-config; no new surface |
| P3 | MED | Path prose says `.shipwright/shipwright_events.jsonl` | rejected-with-reason — VERIFIED: the real tracked log is at project ROOT (no `.shipwright/` variant exists); matches `campaign-events.ts`. Spec prose imprecise |
| P4 | MED | Dedupe by ts → clock skew; prefer file-order | rejected-with-reason — kept ts-then-file-index parity with `campaign-events.ts` / `campaign_status.py` (spec mandates mirroring; Python parity depended-on). Absent/invalid ts → -Infinity already degrades to file-order |
| P5 | MED | Trailing-newline falsely counted as torn line | accepted-and-fixed — `!line.trim()` guard precedes JSON.parse; added a trailing-newline on-disk test asserting skipped stays 1 |
| P6 | MED | Malformed nested field types | accepted-and-fixed — added a malformed-nested test (tests-as-string, frs-as-object/mixed, commit non-string, spec_impact null → graceful) |
| P7 | MED | Phase/run correlation could mis-scope | accepted-as-designed — runId filters `runs` only; phaseTransitions are global (not runId-keyed), returned in full + documented; A02 owns correlation |
| P8 | LOW | `event-log-types.ts` not in the footprint | accepted-as-documented — genuine shared contract (reader + route + 2 tests); keeps all files < 300 with no baseline ratchet (AC6). Footprint expansion noted |
| P9 | LOW | Field-select vs raw passthrough (data exposure) | accepted-as-designed — explicit field-select; `splitId` + required fields pass through untouched per-value |

## External-Code-Review-Findings (openrouter: gemini + openai)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | HIGH | `EVENT_FILE` should be `.shipwright/shipwright_events.jsonl` | rejected-with-reason — round-trip probe against the LIVE log confirms project-root `shipwright_events.jsonl` (217 real runs projected); reviewer only had the imprecise spec prose |
| C2 | MED | Tests reproduce the "wrong" root path | rejected-with-reason — tests correctly use project root (== production == reality) |
| C3 | MED | Gate signals not projected | rejected-with-reason — gate signals ARE phase transitions (`phase_failed`/`phase_completed` for gate-named phases review/tests/security); no distinct `gate_*` event type exists in the emitter output |
| C4 | MED | Route tests only exercise a stub reader | accepted-and-fixed — added a default-reader filesystem integration test (route→reader→pathGuard→disk) + an absent-log graceful case |
| C5 | LOW | `event-log-types.ts` not in footprint (AC6) | accepted-as-documented — see P8 |
| — | — | gemini | no actionable findings (self-confirmed null-handling correct) |

## Confidence Calibration

Boundary: the event-log file format (producer = iterate/pipeline emitters;
consumer = this reader). Probes run (empirical, not "are you confident?"):

1. **Location probe** → found the spec-prose vs reality mismatch; verified the
   real 428-line log is at project ROOT + `campaign-events.ts` reads there →
   no bug (path was already correct).
2. **Field-coverage cross-check** → FOUND a bug (`commit` omitted) → fixed →
   re-probed.
3. **Round-trip probe against the LIVE log** → `readEventLog(<repo>)`: 217 runs,
   428/428 parsed, 0 skipped, 3 phase transitions; latestRun fully projected
   (`commit:""` preserved, `tests:{13,17}`, `specImpact:"none"`); **0/217 runs
   carry `phaseTimings` → all null (AC2 proven on real data, none fabricated)**;
   runId filter matched a real adr_id → no bug.

Asymptote: bug found (probe 2) → fixed → two consecutive clean probes (3 +
runId-filter) → boundary calibrated.

Edge cases NOT probed + why acceptable:
- `phase_timings` PRESENT shape — 0 real rows carry it (emitter verified but
  no local rows). Covered by a fixture read-through test; A02 owns semantics.
- `splitId` on transitions — 0 real rows yet (monorepo #369). Covered by
  camelCase + snake_case fixture read-through tests.
- Multi-project cross-leak — N/A (no user path input; registry-resolved id).
