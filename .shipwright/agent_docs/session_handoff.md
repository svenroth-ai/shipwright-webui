---
canon_generated: true
run_id: "iterate-2026-05-25-fix-tree-ignored-directory-negation"
phase: "iterate"
reason: "iterate: fix tree-route directory-form negation"
timestamp: "2026-05-25T18:46:55.727908+00:00"
---

# Session Handoff

> Auto-generated 2026-05-25 18:46:55 UTC

## Session Info

- **Session ID**: 3ccd2831-b188-45a6-bb2c-5ac7a4d869f0
- **Timestamp**: 2026-05-25 18:46:55 UTC
- **Reason**: iterate: fix tree-route directory-form negation

## Last Iterate

- **Run ID**: iterate-2026-05-23-reconcile-b7-missing-events
- **Date**: 2026-05-23T21:28:30.851020Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/reconcile-b7-missing-events
- **ADR**: iterate-2026-05-23-reconcile-b7-missing-events
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/fix-tree-ignored-directory-negation
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

- **Branch**: iterate/fix-tree-ignored-directory-negation
- **Last Commit**: 6a624c3 Merge pull request #59 from svenroth-ai/iterate/reconcile-b7-missing-events
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
| evt-b8e3e871 | work_completed | iterate (tree-route directory-form negation) | 2026-05-25 |
| evt-994b3a6e | work_completed | iterate (Backfill 14 work_completed events for chore/docs commits between v0.14.0 and v0.16.0 that bypassed the iterate flow) | 2026-05-23 |
| evt-efb0e1e3 | work_completed | iterate (doc-sync meta-test follows Phase 0f file-map move) | 2026-05-23 |
| evt-5be61962 | work_completed | iterate (chore(launch-prep): publish .shipwright/ SDLC documentation) | 2026-05-23 |
| evt-9da1a669 | work_completed | iterate (chore(launch-prep): scrub local paths, Tailscale host and IP) | 2026-05-23 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 150
- **Last iterate**: bug — tree-route directory-form negation (2026-05-25)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-123: Auto-focus xterm on Terminal tab activation
- **Date:** 2026-05-23
- **Section:** Iterate — change: terminal tab autofocus
- **Run-ID:** iterate-2026-05-23-terminal-tab-autofocus
- **Context:** User reported: clicking the Terminal tab leaves keyboard focus on the tab trigger button — user has to click into the canvas before typing. VS Code's integrated terminal grabs focus automatically on tab switch.
- **Decision:** Add a useEffect in EmbeddedTerminal.tsx gated on (active, socket.ready) wi
