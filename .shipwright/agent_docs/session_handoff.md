---
canon_generated: true
run_id: "iterate-2026-09-03-claim-holder-launch"
phase: "iterate"
reason: "iterate: claim-holder launch gate (FR-04.22/V5)"
timestamp: "2026-09-03T20:25:47.108462+00:00"
---

# Session Handoff

> Auto-generated 2026-09-03 20:25:47 UTC

## Session Info

- **Session ID**: 4c49e778-ab48-4e6f-8c50-46d93d5f7145
- **Timestamp**: 2026-09-03 20:25:47 UTC
- **Reason**: iterate: claim-holder launch gate (FR-04.22/V5)

## Last Iterate

- **Run ID**: iterate-2026-09-03-claim-holder-launch
- **Date**: 2026-09-03T20:26:30.180082Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/claim-holder-launch
- **ADR**: iterate-2026-09-03-claim-holder-launch
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/claim-holder-launch
- **External Review Marker**: skipped_config_disabled (external_review_state.json @ 2026-09-01T20:56:59)
- **Review Cascade**: no run_id resolved

### Mandatory replay on Resume

Before dispatching to the handoff's Remaining phase, run these if missing:
- Finalization (F0–F11) after all mandatory phases pass

## Legacy build state

- **Phase**: design
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: iterate/claim-holder-launch
- **Last Commit**: ab9d76ef fix(finalize): keep derived compliance snapshots out of the iterate PR
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
| evt-6deb46a4 | work_completed | iterate (POST /launch now re-reads the claimed task fresh from disk and lets the claim holder (re)launch within a 24h window, closing the stale-in-memory-claim window that previously let a second runner launch a claimed task.) | 2026-09-03 |
| evt-f081c221 | work_completed | iterate (Wire useOrgThreads() to leadwright's real round-store producer (lead-question-threads.json, FR-04.42) instead of the stub) | 2026-09-03 |
| evt-ffe1d2d2 | grade_snapshot | — | 2026-09-02 |
| evt-9f4d68ae | work_completed | iterate (Task Board: claimed-card chip (who + since when, keyed on claimedBy/claimedAt not state) and an independent toolbar filter toggle for claimed tasks (lead-model-spec.md section 5.2, FR-04.22).) | 2026-09-02 |
| evt-613558a6 | event_amended | — | 2026-09-01 |

## Recovery

- **Pipeline**: 2 phases completed
- **Total work events**: 450
- **Last iterate**: change — POST /launch now re-reads the claimed task fresh from disk and lets the claim holder (re)launch within a 24h window, closing the stale-in-memory-claim window that previously let a second runner launch a claimed task. (2026-09-03)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-296: Trusted-publishing npm workflow (OIDC) — reverse the no-publish-workflow stance
- **Date:** 2026-09-01
- **Section:** Release / CI supply chain
- **Run-ID:** iterate-2026-09-01-trusted-publish-workflow
- **Context:** Prior stance (npm-publish skill + repo): NO publish workflow — the human gate was the manual npm publish with 2FA/OTP. Every latest release was thus a manual, 2FA-gated step (webui 0.25.0 shipped this way), with no build provenance and operator availability as a release blocker
