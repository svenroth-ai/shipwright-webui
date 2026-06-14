---
canon_generated: true
run_id: "iterate-2026-06-14-repair-claude-json"
phase: "iterate"
reason: "iterate: deploy-time ~/.claude.json self-heal"
timestamp: "2026-06-14T06:41:07.910859+00:00"
---

# Session Handoff

> Auto-generated 2026-06-14 06:41:07 UTC

## Session Info

- **Session ID**: 29e1b335-3576-42db-8620-68f5e5194c31
- **Timestamp**: 2026-06-14 06:41:07 UTC
- **Reason**: iterate: deploy-time ~/.claude.json self-heal

## Last Iterate

- **Run ID**: iterate-2026-06-13-fix-pty-env-child-session-leak
- **Date**: 2026-06-13T21:53:11.510517Z
- **Type**: bug
- **Complexity**: small
- **Branch**: iterate/fix-pty-env-child-session-leak
- **ADR**: iterate-2026-06-13-fix-pty-env-child-session-leak
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/repair-claude-json
- **Run ID**: iterate-2026-06-14-repair-claude-json
- **Spec**: .shipwright/planning/iterate/2026-06-14-repair-claude-json.md
- **Complexity**: small (classifier: small, prior_source=history); voluntarily applying
- **External Review Marker**: stale (predates spec (2026-06-03T14:56:50))

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

- **Branch**: iterate/repair-claude-json
- **Last Commit**: 7eec0b3 chore(triage): sweep 2 outbox append(s) into branch
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
| evt-fa461ee7 | work_completed | iterate (Deploy-time self-heal of a truncation-tail-corrupt ~/.claude.json: new ops helper scripts/repair-claude-json.mjs + start-server-production.ps1 step 0) | 2026-06-14 |
| evt-1ddcfe3e | work_completed | iterate (buildSpawnEnv strips inherited CLAUDE_CODE_CHILD_SESSION/SESSION_ID/ENTRYPOINT/CLAUDECODE so embedded-terminal claude launches top-level and writes its <uuid>.jsonl; fixes empty Transcripts tab when the server was started from inside a Claude session.) | 2026-06-13 |
| evt-e1825369 | work_completed | iterate (Correct stale .webui/actions.json -> .shipwright-webui/actions.json in live spec.md FR descriptions + acceptance criteria (post-v0.17.0 rename); regenerate traceability matrix.) | 2026-06-13 |
| evt-634409d3 | work_completed | iterate (Thorough guide.md correctness audit vs code/ADRs/RTM (3 sub-agents): fix §6.1 menu location + Plain Claude sibling, §9.3 validation/placeholder/modal_fields drift, add §6.9 Campaigns lane + §6.10 file-editor docs; align server+client package.json version to 0.18.0.) | 2026-06-13 |
| evt-0ceb5d70 | work_completed | iterate (docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify) | 2026-06-13 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 217
- **Last iterate**: change — Deploy-time self-heal of a truncation-tail-corrupt ~/.claude.json: new ops helper scripts/repair-claude-json.mjs + start-server-production.ps1 step 0 (2026-06-14)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-170: Project Campaigns-board status from the tracked event log
- **Date:** 2026-06-11
- **Section:** shipwright-webui / Campaigns lane (FR-01.31)
- **Run-ID:** iterate-2026-06-11-campaign-events-projection
- **Context:** Campaign planning dirs (campaign.md + status.json) are gitignored/local-only (webui PR #121, monorepo PR #189), so a fresh clone/redeploy had no campaign dir and readCampaigns returned empty; the board showed nothing. Local working-tree instances still worked. Monorepo intent: p
