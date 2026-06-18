---
canon_generated: true
run_id: "iterate-2026-06-19-deploy-npm-install"
phase: "iterate"
reason: "F11 refresh-if-behind before PR"
timestamp: "2026-06-18T22:18:23.826043+00:00"
---

# Session Handoff

> Auto-generated 2026-06-18 22:18:23 UTC

## Session Info

- **Session ID**: 9feac2c5-f3ae-4230-9ae6-f08ea0d357b9
- **Timestamp**: 2026-06-18 22:18:23 UTC
- **Reason**: F11 refresh-if-behind before PR

## Last Iterate

- **Run ID**: iterate-2026-06-19-deploy-npm-install
- **Date**: 2026-06-18T22:17:24.005299Z
- **Type**: bug
- **Complexity**: small
- **Branch**: iterate/deploy-npm-install
- **ADR**: iterate-2026-06-19-deploy-npm-install
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/deploy-npm-install
- **External Review Marker**: completed (external_review_state.json @ 2026-06-03T14:56:50)

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: iterate/deploy-npm-install
- **Last Commit**: 3af005c Merge remote-tracking branch 'origin/main' into iterate/deploy-npm-install
- **Uncommitted Changes**: None

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
| evt-a73ab76b | work_completed | iterate (start-server-production.ps1 and install-windows.ps1 run npm install before npm run build so a newly-merged dependency (@dnd-kit/core) no longer breaks the production build; autostart no longer swallows npm errors.) | 2026-06-18 |
| evt-01f600fb | work_completed | iterate (Embedded terminal WS now reconnects on tab refocus + has a client liveness heartbeat (app-level ping/pong) so a silently-dead socket after sleep/Tailscale partition is detected and recovered instead of a stale frozen frame.) | 2026-06-18 |
| evt-2646f4da | work_completed | iterate (Task-board drag-and-drop with the board column decoupled from session state (sticky boardColumn override, schema v4, POST /tasks/:id/column, accessible Move-to menu + keydown-guard fix).) | 2026-06-17 |
| evt-c38be8a4 | work_completed | iterate (sync vendored gate copies to monorepo fail-closed fixes) | 2026-06-17 |
| evt-cf5f9f11 | work_completed | iterate (launch-prep README Beta badge, issue templates & tooling) | 2026-06-17 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 237
- **Last iterate**: bug — start-server-production.ps1 and install-windows.ps1 run npm install before npm run build so a newly-merged dependency (@dnd-kit/core) no longer breaks the production build; autostart no longer swallows npm errors. (2026-06-18)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-199: Scrub residual PII + close the *.md.lock gitignore gap
- **Date:** 2026-06-17
- **Section:** Iterate — change: launch-prep PII scrub & repo hygiene
- **Run-ID:** iterate-2026-06-17-launch-prep-scrub
- **Context:** Pre-public-launch audit found residual PII in tracked files: dev username + company name + an internal Tailscale IP inside two .shipwright/triage.jsonl records and a hardcoded home path in one planning doc, plus a tracked decision_log.md.lock sidecar and 7 unreferenced E2E screens
