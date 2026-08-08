---
canon_generated: true
run_id: "changelog-v0.24.0-20260808-1500"
phase: "changelog"
reason: "release v0.24.0"
timestamp: "2026-08-08T20:38:36.160644+00:00"
---

# Session Handoff

> Auto-generated 2026-08-08 20:38:36 UTC

## Session Info

- **Session ID**: b24c7537-4b35-4585-be92-02ee02b3ff6b
- **Timestamp**: 2026-08-08 20:38:36 UTC
- **Reason**: release v0.24.0

## Last Iterate

- **Run ID**: iterate-2026-08-08-tests-total-skip-contract
- **Date**: 2026-08-08T10:36:25.721563Z
- **Type**: change
- **Complexity**: medium
- **Branch**: iterate/tests-total-skip-contract
- **ADR**: iterate-2026-08-08-tests-total-skip-contract
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/iterate-2026-08-08-tests-total-skip-contract.md

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: feat/track-model-config-allowlist
- **Last Commit**: e76e3fc1 chore(release): v0.24.0
- **Uncommitted Changes**: Yes

## Config Files to Read

- `shipwright_run_config.json` — exists
- `shipwright_project_config.json` — exists
- `shipwright_plan_config.json` — exists
- `shipwright_build_config.json` — exists
- `shipwright_security_config.json` — missing
- `shipwright_compliance_config.json` — exists

## Last Events

| Event | Type | Source | Date |
|-------|------|--------|------|
| evt-85922e16 | phase_completed | changelog | 2026-08-08 |
| evt-922b9978 | grade_snapshot | — | 2026-08-08 |
| evt-53b4782d | work_completed | iterate (Adds view-only Priority/Domain/Complexity filters and an independent two-level sort (Domain/Name/Modified) to the Triage tab; drops the per-source group heading; adds a Parked filter (default-hidden) with due-park and dateless-park escape hatches.) | 2026-08-08 |
| evt-a444cb0d | work_completed | iterate (Epoch-gated resolution of tests.total (collected vs executed) — resolves the cross-repo contract conflict with the monorepo's tests_block.py producer, so a host-gated skip reads as a genuine pass with the skip disclosed instead of a failure.) | 2026-08-08 |
| evt-2d0b9be9 | event_amended | — | 2026-08-05 |

## Recovery

- **Pipeline**: 2 phases completed
- **Total work events**: 398
- **Last iterate**: feature — Adds view-only Priority/Domain/Complexity filters and an independent two-level sort (Domain/Name/Modified) to the Triage tab; drops the per-source group heading; adds a Parked filter (default-hidden) with due-park and dateless-park escape hatches. (2026-08-08)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-264: Mission stage derived from real phase markers; TodoWrite premise falsified empirically
- **Date:** 2026-07-19
- **Section:** Iterate - change: mission lifecycle stage
- **Run-ID:** iterate-2026-07-19-mission-s4-honest-lifecycle-stage
- **Context:** The 'Where it stands' stepper left Analyze far too early: inferStage was furthest-along-wins over coarse tool signals, so the first Edit/Write to any non-spec file set Build, and Build outranks Analyze. A scratchpad probe or memory note written d
