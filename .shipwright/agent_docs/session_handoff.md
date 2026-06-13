---
canon_generated: true
run_id: "iterate-2026-06-13-docs-readme-install-audit"
phase: "iterate"
reason: "iterate: docs README/guide install audit"
timestamp: "2026-06-13T07:24:48.087348+00:00"
---

# Session Handoff

> Auto-generated 2026-06-13 07:24:48 UTC

## Session Info

- **Session ID**: 9a409808-d6bf-4c39-85ee-357250bdd850
- **Timestamp**: 2026-06-13 07:24:48 UTC
- **Reason**: iterate: docs README/guide install audit

## Last Iterate

- **Run ID**: iterate-2026-06-13-docs-readme-install-audit
- **Date**: 2026-06-13T07:24:28.991829Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/docs-readme-install-audit
- **ADR**: iterate-2026-06-13-docs-readme-install-audit
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/docs-readme-install-audit
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

- **Branch**: iterate/docs-readme-install-audit
- **Last Commit**: c3aed61 chore(triage): sweep 1 outbox append(s) into branch
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
| evt-0ceb5d70 | work_completed | iterate (docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify) | 2026-06-13 |
| evt-a3235e14 | work_completed | iterate (Reconcile post-v0.18.0 detective audit F5: document the convention-impact drop iterate-2026-06-12-automerge-pr-review-alignment under conventions.md (## Convention Updates). B7 (commit 82021094) and G2 (scopes review/actions, then agent-docs) were already resolved on origin/main by PR #127/#129; F5 had migrated to this drop.) | 2026-06-13 |
| evt-b52512c5 | work_completed | iterate (Flat Campaigns-lane card (remove heavy shadow) + fix List-view right-column clipping) | 2026-06-12 |
| evt-0928faf6 | work_completed | iterate (compliance G2/H1/H2 bloat-baseline reconcile) | 2026-06-12 |
| evt-e2c221a0 | work_completed | iterate (Condense agent_docs (architecture.md + conventions.md) to ADR-anchored pointers; fix structural drift + a launchPayload ADR mislabel) | 2026-06-12 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 213
- **Last iterate**: change — docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify (2026-06-13)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-170: Project Campaigns-board status from the tracked event log
- **Date:** 2026-06-11
- **Section:** shipwright-webui / Campaigns lane (FR-01.31)
- **Run-ID:** iterate-2026-06-11-campaign-events-projection
- **Context:** Campaign planning dirs (campaign.md + status.json) are gitignored/local-only (webui PR #121, monorepo PR #189), so a fresh clone/redeploy had no campaign dir and readCampaigns returned empty; the board showed nothing. Local working-tree instances still worked. Monorepo intent: p
