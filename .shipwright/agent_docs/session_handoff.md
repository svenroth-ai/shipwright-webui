---
canon_generated: true
run_id: "changelog-v0.24.0-20260808-1500"
phase: "changelog"
reason: "release v0.24.0"
timestamp: "2026-08-08T20:38:36.160644+00:00"
---

# Session Handoff

> Auto-generated 2026-09-06 07:59:30 UTC

## Session Info

- **Session ID**: 38877717-d36f-414b-a196-7038dba3ff75
- **Timestamp**: 2026-09-06 07:59:30 UTC
- **Reason**: iterate completion: iterate-2026-09-06-tablet-ipad-ux-pass

## Last Iterate

- **Run ID**: iterate-2026-09-06-tablet-ipad-ux-pass
- **Date**: 2026-09-06T08:05:59.301667Z
- **Type**: change
- **Complexity**: medium
- **Branch**: iterate/tablet-ipad-ux-pass
- **ADR**: iterate-2026-09-06-tablet-ipad-ux-pass
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/2026-09-06-tablet-ipad-ux-pass.md

## Current Iterate Progress

- **Branch**: iterate/tablet-ipad-ux-pass
- **Spec**: .shipwright/planning/iterate/2026-09-06-tablet-ipad-ux-pass.md
- **Complexity**: medium (`classify_complexity.py`: estimate=medium,
- **External Review Marker**: stale (predates spec (2026-09-01T20:56:59))
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

- **Branch**: iterate/tablet-ipad-ux-pass
- **Last Commit**: 75aa857c chore(iterate): correct F0.5 evidence in the per-run test-results snapshot
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
| evt-f269fd1e | grade_snapshot | — | 2026-09-06 |
| evt-12aa1dda | work_completed | iterate (Tablet/iPad UX pass: terminal reconnecting banner now surfaces the existing WS liveness probe instead of a silent stale frame; task titles single-line-truncate with tap-to-expand/tooltip at tablet AND desktop widths instead of wrapping; Ships Log Documents panel scrolls independently of the Log column at every viewport width.) | 2026-09-06 |
| evt-24451fc7 | work_completed | iterate (Chunk PtyManager.write() into sub-KB UTF-8-safe pieces (with a same-task write queue) to stop a production macOS hang: an oversized single-burst write into a task's first-launch command could deadlock the whole server by overrunning the shell's tty input queue.) | 2026-09-04 |
| evt-35d58ea9 | grade_snapshot | — | 2026-09-05 |
| evt-99f0f682 | work_completed | iterate (Desktop sidebar collapse/expand (icons-only, persisted, default expanded) + Diagnostics page shows WebUI version and Shipwright plugin version) | 2026-09-05 |

## Recovery

- **Pipeline**: 2 phases completed
- **Total work events**: 456
- **Last iterate**: change — Tablet/iPad UX pass: terminal reconnecting banner now surfaces the existing WS liveness probe instead of a silent stale frame; task titles single-line-truncate with tap-to-expand/tooltip at tablet AND desktop widths instead of wrapping; Ships Log Documents panel scrolls independently of the Log column at every viewport width. (2026-09-06)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-308: Chunk pty.write() to stop the macOS large-command hang
- **Date:** 2026-09-05
- **Section:** Iterate — bug: embedded-terminal-large-command-hang
- **Run-ID:** iterate-2026-09-05-terminal-large-command-chunked-pty-write
- **Context:** Prod incident (macOS): a first launch with a ~5.8KB prompt baked into the command froze the server. PtyManager.write() forwarded the whole burst in one call; macOS's ~1KB canonical-mode tty queue can't drain until the trailing newline arrives, which was stuck a
