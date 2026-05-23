---
canon_generated: true
run_id: "iterate-2026-05-23-fix-ci-doc-sync-claude-md"
phase: "iterate"
reason: "iterate: fix doc-sync meta-test (CI failure on main@34ac661)"
timestamp: "2026-05-23T21:20:26.219746+00:00"
---

# Session Handoff

> Auto-generated 2026-05-23 21:20:26 UTC

## Session Info

- **Session ID**: a09571f2-1ade-4291-b65c-09c5c1b65644
- **Timestamp**: 2026-05-23 21:20:26 UTC
- **Reason**: iterate: fix doc-sync meta-test (CI failure on main@34ac661)

## Last Iterate

- **Run ID**: iterate-2026-05-23-terminal-tab-autofocus
- **Date**: 2026-05-23T06:57:58.440562Z
- **Type**: change
- **Complexity**: trivial
- **Branch**: iterate/terminal-tab-autofocus
- **ADR**: iterate-2026-05-23-terminal-tab-autofocus
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/fix-ci-doc-sync-claude-md
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

- **Branch**: iterate/fix-ci-doc-sync-claude-md
- **Last Commit**: 34ac661 chore(release): v0.16.0
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
| evt-efb0e1e3 | work_completed | iterate (doc-sync meta-test follows Phase 0f file-map move) | 2026-05-23 |
| evt-5be61962 | work_completed | iterate (chore(launch-prep): publish .shipwright/ SDLC documentation) | 2026-05-23 |
| evt-9da1a669 | work_completed | iterate (chore(launch-prep): scrub local paths, Tailscale host and IP) | 2026-05-23 |
| evt-0e23fcba | work_completed | iterate (chore(launch-prep): drop stale skill-compliance docs, fix doc path refs) | 2026-05-23 |
| evt-370f608f | work_completed | iterate (docs(governance): add CODE_OF_CONDUCT, CONTRIBUTING, SECURITY policy) | 2026-05-23 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 148
- **Last iterate**: bug — doc-sync meta-test follows Phase 0f file-map move (2026-05-23)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-123: Auto-focus xterm on Terminal tab activation
- **Date:** 2026-05-23
- **Section:** Iterate — change: terminal tab autofocus
- **Run-ID:** iterate-2026-05-23-terminal-tab-autofocus
- **Context:** User reported: clicking the Terminal tab leaves keyboard focus on the tab trigger button — user has to click into the canvas before typing. VS Code's integrated terminal grabs focus automatically on tab switch.
- **Decision:** Add a useEffect in EmbeddedTerminal.tsx gated on (active, socket.ready) wi
