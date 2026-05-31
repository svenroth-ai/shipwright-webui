# Session Handoff

> Auto-generated 2026-05-31 13:18:30 UTC

## Session Info

- **Session ID**: 33c5e5d2-b045-424e-af70-e3059e5ba890
- **Timestamp**: 2026-05-31 13:18:30 UTC
- **Reason**: release v0.17.0

## Last Iterate

- **Run ID**: iterate-2026-05-31-reopen-done-task
- **Date**: 2026-05-31T13:18:36.534523Z
- **Type**: feature
- **Complexity**: medium
- **Branch**: iterate/reopen-done-task
- **ADR**: iterate-2026-05-31-reopen-done-task
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/2026-05-31-reopen-done-task.md

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: main
- **Last Commit**: b543532 chore(release): v0.17.0
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
| evt-3445c91e | work_completed | iterate (WS liveness keepalive complete; PR pending) | 2026-05-31 |
| evt-83b9b73f | work_completed | iterate (POST /api/external/tasks/:id/reopen flips done->draft (counterpart of /backlog), session preserved; TaskCardMenu hosts the isDone-gated Re-open item) | 2026-05-31 |
| evt-ecef8b79 | work_completed | iterate (SmartViewer pop-out opens a centered in-app modal (Radix Dialog) instead of window.open to a new browser tab; popOut threaded SmartViewer->MarkdownRenderer to suppress the nested control; /preview route retained.) | 2026-05-31 |
| evt-b2bdc9ae | work_completed | iterate (page-chrome cleanup: remove Diagnostics Launchers section and align Triage header to Inbox/Projects) | 2026-05-30 |
| evt-2aa8923c | work_completed | iterate (PR card bubble parity + open/merged status badge via gh pr view) | 2026-05-30 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 168
- **Last iterate**: change — WS liveness keepalive complete; PR pending (2026-05-31)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-147: Accept pty-manager.ts as deep module; baseline state=exception
- **Date:** 2026-05-25
- **Section:** Campaign C C8
- **Run-ID:** sub_iterate-20260525-213548
- **Context:** server/src/terminal/pty-manager.ts is 1198 LOC against the 300 limit; state=grandfathered since Campaign A.defense. Campaign C removes anonymous TODO entries.
- **Decision:** File ADR-101; flip baseline entry to state=exception, adr=ADR-101. No code change to pty-manager.ts. Re-Review-Date 2026-08-25 (when an auth layer m
