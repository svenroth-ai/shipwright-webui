# Iterate specification — MIS-1 Mission artifacts

- **Run ID:** `iterate-2026-08-11-mis-1-mission-artifacts`
- **Type / complexity:** change / medium
- **Spec impact:** MODIFY `FR-01.66` (Mission view)

## Outcome

Make Mission artifacts use the resolved iterate identity and their recorded evidence so a completed Mission is not described as an unfinished pipeline task. Requirements must state whether their evidence is still being discovered, planned from the iterate specification, or recorded at completion. Tests must lead with the producer's existing gate and enrich it from the immutable per-run F5c snapshot where available.

## Acceptance criteria

1. An iterate Mission centre card uses `MissionContext.runId` and terminal Mission artifacts, never a task pipeline `runId`.
2. Requirement detail shows the resolved ID, title, plain-language description, area, fold provenance, and an opaque-document-backed requirements-spec source link. It distinguishes Discovering, Planned, Recorded, and explicit `NONE`.
3. Tests show distinct Passed, Failed, Needs attention, and No reliable result messages; skips, malformed or partial counts, and all-skipped runs are never greenwashed. F5c test-completeness evidence augments its detail when readable.
4. Decision drops say `Recorded — ADR number assigned at release`; published entries say `Published as ADR-NNN`.
5. Requirement, Tests, Review, Decisions and Commit detail panes share normal-flow header spacing with no toolbar collision.
6. Focused server and client tests cover source order, lifecycle transitions, terminal centre-card identity, and evidence degradation.

## Design notes

The existing Mission side panel remains the shared chrome. Its toolbar, eyebrow, title/summary and typed body are restructured in normal document flow; no absolute positioning is introduced. Existing Mission tokens and compact-panel behaviour are retained.

## Affected boundaries

- `server/src/core/mission-context/` reads existing iterate spec, work-completed, adopted-spec and F5c evidence only.
- `client/src/components/external/mission/` and its mirrored wire types render those facts in English.
- `FR-01.66` records the observable Mission behaviour.
