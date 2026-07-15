---
canon_generated: true
run_id: "iterate-2026-07-15-e2e-pty-spawn-cwd-267"
phase: "iterate"
reason: "F11 pre-merge refresh: iterate-2026-07-15-e2e-pty-spawn-cwd-267"
timestamp: "2026-07-15T14:43:27.584673+00:00"
---

# Session Handoff

> Auto-generated 2026-07-15 14:43:27 UTC

## Session Info

- **Session ID**: d386e062-1883-40e6-895b-325f69a68118
- **Timestamp**: 2026-07-15 14:43:27 UTC
- **Reason**: F11 pre-merge refresh: iterate-2026-07-15-e2e-pty-spawn-cwd-267

## Last Iterate

- **Run ID**: iterate-2026-07-15-e2e-pty-spawn-cwd-267
- **Date**: 2026-07-15T14:44:20.995213Z
- **Type**: bug
- **Complexity**: medium
- **Branch**: iterate/e2e-pty-spawn-cwd-267
- **ADR**: iterate-2026-07-15-e2e-pty-spawn-cwd-267
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/iterate-2026-07-15-e2e-pty-spawn-cwd-267/spec.md

## Current Iterate Progress

- **Branch**: iterate/e2e-pty-spawn-cwd-267
- **External Review Marker**: completed (external_review_state.json @ 2026-07-08T13:26:14)

### Mandatory replay on Resume

Before dispatching to the handoff's Remaining phase, run these if missing:
- Finalization (F0–F11) after all mandatory phases pass

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: iterate/e2e-pty-spawn-cwd-267
- **Last Commit**: 23fe3396 Merge remote-tracking branch 'origin/main' into iterate/e2e-pty-spawn-cwd-267
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
| evt-e9c44c6b | grade_snapshot | — | 2026-07-15 |
| evt-0bcf5fcb | work_completed | iterate (Fix v0-9-5-task-type-matrix E2E: write v2/xterm@6.0.0 snapshot header (was stale v1/5.5.0) so the server replay version-gate accepts it and the task-type x scenario matrix (16 tests) passes.) | 2026-07-15 |
| evt-033e5a72 | grade_snapshot | — | 2026-07-15 |
| evt-721ec7ab | work_completed | iterate (Pty spawn against a removed/delete-pending cwd now degrades cleanly (typed PtySpawnFailedError -> deterministic WS-upgrade rejection + 409 task_cwd_unusable / neutral 500 from prewarm) instead of an uncaught Windows error 267 at the spawn seam. Root cause: 267 = ERROR_DIRECTORY, not ConPTY resource exhaustion (empirically falsified).) | 2026-07-15 |
| evt-cd69e16a | grade_snapshot | — | 2026-07-15 |

## Recovery

- **Pipeline**: 2 phases completed
- **Total work events**: 313
- **Last iterate**: bug — Fix v0-9-5-task-type-matrix E2E: write v2/xterm@6.0.0 snapshot header (was stale v1/5.5.0) so the server replay version-gate accepts it and the task-type x scenario matrix (16 tests) passes. (2026-07-15)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-263: Share the ADR-096 preserve-gate across both snapshot write paths
- **Date:** 2026-07-12
- **Section:** Iterate — bug: mirror-flush snapshot preservation gate
- **Run-ID:** iterate-2026-07-12-mirror-flush-preserve-gate
- **Context:** flushMirrorSnapshot (ADR-092 last-detach) wrote unconditionally while finalizeMirrorSnapshot had the ADR-096 preserve gate; on the 2nd detach->reopen cycle a thin mirror clobbered the richer disk snapshot, blanking terminal scrollback.
- **Decision:** Extract th
