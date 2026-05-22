---
canon_generated: true
run_id: "iterate-2026-05-22-spa-fallback"
phase: "iterate"
reason: "post-rebase onto #51+#54: regen bookkeeping"
timestamp: "2026-05-22T12:48:42.323451+00:00"
---

# Session Handoff

> Auto-generated 2026-05-22 12:48:42 UTC

## Session Info

- **Session ID**: 57a2b26b-23e5-43ba-8fee-8022c31064d7
- **Timestamp**: 2026-05-22 12:48:42 UTC
- **Reason**: post-rebase onto #51+#54: regen bookkeeping

## Last Iterate

- **Run ID**: iterate-2026-05-22-triage-fix-now-project-preselect
- **Date**: 2026-05-22T12:47:19.899694Z
- **Type**: bug
- **Complexity**: small
- **Branch**: iterate/triage-fix-now-project-preselect
- **ADR**: iterate-2026-05-22-triage-fix-now-project-preselect
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/spa-fallback
- **External Review Marker**: skipped_no_api_key (external_review_state.json @ 2026-05-21T00:00:00)

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

- **Branch**: iterate/spa-fallback
- **Last Commit**: 55d0288 fix(server): SPA fallback to client/dist/index.html for non-/api GETs
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
| evt-86356188 | work_completed | iterate (triage Fix-now pre-selects the triage item's project in NewIssueModal) | 2026-05-22 |
| evt-663ee6f3 | work_completed | iterate (SPA fallback for /triage, /inbox & friends (Hono server)) | 2026-05-22 |
| evt-6ca6247c | work_completed | iterate (VERIFICATION: bug+change-type — should pass) | 2026-05-21 |
| evt-904b92f3 | work_completed | iterate (VERIFICATION: with affected-frs — should pass) | 2026-05-21 |
| evt-4af079b7 | work_completed | iterate (triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes (+ FR-01.30 spec follow-up)) | 2026-05-21 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 131
- **Last iterate**: bug — triage Fix-now pre-selects the triage item's project in NewIssueModal (2026-05-22)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-115: oxlint replaces the dead lint script; CORS test env-isolated via vi.hoisted
- **Date:** 2026-05-19
- **Section:** Iterate — change: oxlint adoption + CORS test env-isolation
- **Run-ID:** iterate-2026-05-19-oxlint-and-cors-env
- **Context:** Two pre-existing tooling/test-hygiene defects, surfaced during PR #33. (a) server/src/index.test.ts read process.env ambient; a dev shell with SHIPWRIGHT_NETWORK_PROFILE=tailscale widened the import-time-baked CORS policy and failed the default-loopback
