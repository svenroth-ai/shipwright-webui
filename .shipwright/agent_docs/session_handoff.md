---
canon_generated: true
run_id: "iterate-2026-06-02-terminal-idle-attachment-gate"
phase: "iterate"
reason: "iterate complete: terminal idle-ceiling attachment-gating + 12h grace + resume data-loss banner"
timestamp: "2026-06-02T08:26:06.171789+00:00"
---

# Session Handoff

> Auto-generated 2026-06-02 08:26:06 UTC

## Session Info

- **Session ID**: 7bb32862-55f8-47f3-8e1f-a644ab44b270
- **Timestamp**: 2026-06-02 08:26:06 UTC
- **Reason**: iterate complete: terminal idle-ceiling attachment-gating + 12h grace + resume data-loss banner

## Last Iterate

- **Run ID**: iterate-2026-06-02-terminal-idle-attachment-gate
- **Date**: 2026-06-02T08:26:06.043620Z
- **Type**: bug
- **Complexity**: medium
- **Branch**: iterate/terminal-idle-attachment-gate
- **ADR**: iterate-2026-06-02-terminal-idle-attachment-gate
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/2026-06-02-terminal-idle-attachment-gate.md

## Current Iterate Progress

- **Branch**: iterate/terminal-idle-attachment-gate
- **Run ID**: iterate-2026-06-02-terminal-idle-attachment-gate
- **Spec**: .shipwright/planning/iterate/2026-06-02-terminal-idle-attachment-gate.md
- **Complexity**: medium (override of classifier `small`)
- **External Review Marker**: stale (predates spec (2026-05-26T21:45:17))

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

- **Branch**: iterate/terminal-idle-attachment-gate
- **Last Commit**: 47f7450 fix(terminal): gate idle-ceiling on client attachment to stop resume data-loss
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
| evt-f0f196d7 | work_completed | iterate (Gate terminal idle-ceiling on client attachment so a watched session is never reaped; raise detached-grace 30min->12h; resume data-loss note on the ADR-104 reset banner.) | 2026-06-02 |
| evt-3445c91e | work_completed | iterate (WS liveness keepalive complete; PR pending) | 2026-05-31 |
| evt-83b9b73f | work_completed | iterate (POST /api/external/tasks/:id/reopen flips done->draft (counterpart of /backlog), session preserved; TaskCardMenu hosts the isDone-gated Re-open item) | 2026-05-31 |
| evt-ecef8b79 | work_completed | iterate (SmartViewer pop-out opens a centered in-app modal (Radix Dialog) instead of window.open to a new browser tab; popOut threaded SmartViewer->MarkdownRenderer to suppress the nested control; /preview route retained.) | 2026-05-31 |
| evt-b2bdc9ae | work_completed | iterate (page-chrome cleanup: remove Diagnostics Launchers section and align Triage header to Inbox/Projects) | 2026-05-30 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 169
- **Last iterate**: bug — Gate terminal idle-ceiling on client attachment so a watched session is never reaped; raise detached-grace 30min->12h; resume data-loss note on the ADR-104 reset banner. (2026-06-02)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-147: Accept pty-manager.ts as deep module; baseline state=exception
- **Date:** 2026-05-25
- **Section:** Campaign C C8
- **Run-ID:** sub_iterate-20260525-213548
- **Context:** server/src/terminal/pty-manager.ts is 1198 LOC against the 300 limit; state=grandfathered since Campaign A.defense. Campaign C removes anonymous TODO entries.
- **Decision:** File ADR-101; flip baseline entry to state=exception, adr=ADR-101. No code change to pty-manager.ts. Re-Review-Date 2026-08-25 (when an auth layer m
