---
canon_generated: true
run_id: "iterate-2026-06-17-launch-prep-docs"
phase: "iterate"
reason: "iterate: launch-prep README Beta badge, issue templates & tooling"
timestamp: "2026-06-17T06:55:51.831073+00:00"
---

# Session Handoff

> Auto-generated 2026-06-17 06:55:51 UTC

## Session Info

- **Session ID**: a2e1acc3-c12a-4a93-b9bf-c6f67bbe6044
- **Timestamp**: 2026-06-17 06:55:51 UTC
- **Reason**: iterate: launch-prep README Beta badge, issue templates & tooling

## Last Iterate

- **Run ID**: iterate-2026-06-17-launch-prep-scrub
- **Date**: 2026-06-17T06:38:24.743481Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/launch-prep-scrub
- **ADR**: iterate-2026-06-17-launch-prep-scrub
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/launch-prep-docs
- **External Review Marker**: completed (external_review_state.json @ 2026-06-03T14:56:50)

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

- **Branch**: iterate/launch-prep-docs
- **Last Commit**: 4f00383 chore(launch-prep): scrub residual PII and tighten repo hygiene (#154)
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
| evt-cf5f9f11 | work_completed | iterate (launch-prep README Beta badge, issue templates & tooling) | 2026-06-17 |
| evt-4dd9f8c2 | work_completed | iterate (launch-prep PII scrub & repo hygiene) | 2026-06-17 |
| evt-85988543 | work_completed | iterate (editor HTML link corruption on save (FR-01.34)) | 2026-06-16 |
| evt-7884a2bc | work_completed | iterate (Touch-scroll replicates the mouse/trackpad: a finger-pan dispatches a synthetic pixel-mode WheelEvent on term.element so xterm encodes the same mouse-report Claude already consumes for the mouse wheel, instead of arrow keys that Claude interpreted as input-history navigation. Supersedes ADR-132. Client-only.) | 2026-06-15 |
| evt-6a4edaa8 | work_completed | iterate (Fix read-only narrow replay corruption: useReplayDrainGate resizes the terminal to the snapshot cols/rows before term.write so a wide snapshot reconstructs faithfully in a narrow reader (no character interleaving). Client-only.) | 2026-06-15 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 233
- **Last iterate**: change — launch-prep README Beta badge, issue templates & tooling (2026-06-17)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-196: Touch-scroll replicates the mouse wheel (synthetic WheelEvent on term.element), superseding the ADR-132 arrow-key path
- **Date:** 2026-06-15
- **Section:** Iterate — bug-fix: touch-scroll cycles Claude input history instead of scrolling
- **Run-ID:** iterate-2026-06-15-touch-scroll-wheel-events
- **Context:** User report 2026-06-15 (iPad/Safari): one-finger touch in the embedded terminal cycles Claude's last prompts instead of scrolling; mouse + two-finger trackpad scroll fine. Traced @xte
