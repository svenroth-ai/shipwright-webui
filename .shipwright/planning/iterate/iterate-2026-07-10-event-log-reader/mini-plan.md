# Mini-plan — A01 event-log reader (iterate-2026-07-10-event-log-reader)

## Problem
The WOW campaign's downstream UI (Mission Control's Record + instruments,
Ship's-Log runs/sub-scores/last-proof, board per-run facts) is `reader`-tagged
against per-run facts that live ONLY in `<project>/shipwright_events.jsonl`
(`work_completed.{affected_frs,tests,summary,commit,spec_impact,phase_timings}`
+ phase transitions). No reader exists — `core/campaign-events.ts` is the only
consumer and deliberately projects `commit` alone. This is the one genuine
backend gap in the campaign; everything downstream renders nothing until it lands.

## Approach
1. `core/event-log-reader.ts` (+ `event-log-types.ts` for the shape contract, to
   keep each file < 300 LOC): a tolerant, stateless JSONL projector.
   - `projectEventLog(lines, {runId?})` — pure. Dedupes `work_completed` by
     `adr_id` (latest by ts, file-index tiebreak); projects the full record;
     collects phase transitions in file order (NOT collapsed); counts torn lines.
   - `readEventLog(projectRoot, opts)` — file wrapper, `pathGuard`-resolved,
     graceful empty projection on absent/unreadable log. Never throws.
2. `external/events/routes.ts` — `GET /api/external/projects/:projectId/events
   [?runId=]`, read-only, injected reader (testable). 404 unknown project / 400
   path-less / 200 ok (empty payload when the log is absent). Mounted in the
   registration shell (routes.ts stays < 300 LOC).

## Honesty invariants (campaign AC4 / AC2)
- `phase_timings` read THROUGH untouched → `null` when absent. NEVER
  synthesize/interpolate/back-fill a duration. Consumers render `n/a`.
- Phase transitions read through with `splitId` untouched; a phase may have
  multiple ends (monorepo #369) — never collapsed. A02 owns the join/dedup.
- `event_amended` / `grade_snapshot` are NOT overlaid here — documented, so the
  endpoint never claims an amendment-merged view it does not compute.
- Read-only observer: WebUI never writes events.jsonl (Architecture rule 1).

## Alternatives considered
- Extend `campaign-events.ts` → rejected: its docstring pins "tests intentionally
  NOT projected"; a per-run projection is a different, sibling concern.
- Thread `readEvents` through `createExternalRoutes` args (like `readCompliance`)
  → rejected: unnecessary shell coupling; the events router defaults its own
  reader and tests inject a stub directly. Keeps routes.ts additions to ~5 lines.
- Add the route inside `routes.ts` → rejected: sub-router-per-concern is the
  established C2 convention and keeps routes.ts under its bloat ceiling.

## Test plan
Fixture logs: full / bare-missing-fields / no-phase_timings / torn-line /
non-object / no-adr_id / dedupe / phase-passthrough / runId-filter / absent-file
(real temp dir). Route: 404/400/200 + runId query threading. Hex `runId`/`adr_id`.

## Files
- `server/src/core/event-log-reader.ts` (new) + `event-log-types.ts` (new, split)
- `server/src/core/event-log-reader.test.ts` (new)
- `server/src/external/events/routes.ts` (new) + `routes.test.ts` (new)
- `server/src/external/routes.ts` (+5 lines: import + mount)
- `.shipwright/planning/01-adopted/spec.md` (FR-01.46 row)
