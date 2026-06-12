---
canon_generated: true
run_id: "iterate-2026-06-12-compliance-reconcile-b7-g2"
phase: "iterate"
reason: "iterate: compliance audit reconcile B7/F5/G2"
timestamp: "2026-06-12T09:05:23.192753+00:00"
---

# Session Handoff

> Auto-generated 2026-06-12 09:05:23 UTC

## Session Info

- **Session ID**: 3627e2d6-1149-4f89-9c4b-e25aebde24d7
- **Timestamp**: 2026-06-12 09:05:23 UTC
- **Reason**: iterate: compliance audit reconcile B7/F5/G2

## Last Iterate

- **Run ID**: iterate-2026-06-12-compliance-reconcile-b7-g2
- **Date**: 2026-06-12T09:04:15.518899Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/compliance-reconcile-b7-g2
- **ADR**: iterate-2026-06-12-compliance-reconcile-b7-g2
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/compliance-reconcile-b7-g2
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

- **Branch**: iterate/compliance-reconcile-b7-g2
- **Last Commit**: 60890b9 chore(triage): sweep 1 outbox append(s) into branch
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
| evt-fdbd3b9b | work_completed | iterate (Reconcile post-v0.18.0 detective audit: backfill PR #124 (commit 8202109) missing work_completed event (B7) + register the actions/review conventional-commit scopes in audit_config.json g2_stoplist (G2). F5 was a stale-local-main false positive (PASS on origin/main).) | 2026-06-12 |
| evt-b29aafce | work_completed | iterate (Backfill (B7 reconciliation): WebUI side of routing idle-main triage status flips to the per-tree outbox (mirror of triage.py mark_status TRACKED-PREFERRED residence). shouldRouteToOutbox(projectRoot) = origin remote AND HEAD==default branch, git-probed via spawnSync, failing safe to tracked on any git error. PR #124 (commit 8202109) merged WITHOUT an F5b work_completed event or F6 Run-ID footer; this event is reconstructed from the commit to close the B7 gap.) | 2026-06-11 |
| evt-3436d224 | work_completed | iterate (Manual dismiss/restore (webui-owned board quittance) for Campaigns-board cards; selectVisible/selectDismissed partition + show-dismissed toggle; dismissed-campaigns-store + 2 POST routes + dismissed annotation.) | 2026-06-12 |
| evt-6e8fbec8 | work_completed | iterate (Migrate .github/workflows/claude-review.yml to pr-review.yml: an OpenRouter-backed Tier-3 reviewer (vendored pr_review.py + pr_review_lib.py + prompts under scripts/ci/, logic byte-identical to monorepo B4.5 Phase 2) gated by a decide-job tier filter (external author / sensitive paths .github/workflows,scripts/hooks,scripts/ci / needs-review label). Drops @anthropic-ai/claude-code + ANTHROPIC_API_KEY + the dead develop trigger. Adds an offline selftest job running 72 vendored tests.) | 2026-06-12 |
| evt-06308665 | work_completed | iterate (Optional slash_command on custom actions so {task.initial_prompt} fuses slash+description into one positional; fail-loud schema validation.) | 2026-06-11 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 208
- **Last iterate**: change — Reconcile post-v0.18.0 detective audit: backfill PR #124 (commit 8202109) missing work_completed event (B7) + register the actions/review conventional-commit scopes in audit_config.json g2_stoplist (G2). F5 was a stale-local-main false positive (PASS on origin/main). (2026-06-12)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-170: Project Campaigns-board status from the tracked event log
- **Date:** 2026-06-11
- **Section:** shipwright-webui / Campaigns lane (FR-01.31)
- **Run-ID:** iterate-2026-06-11-campaign-events-projection
- **Context:** Campaign planning dirs (campaign.md + status.json) are gitignored/local-only (webui PR #121, monorepo PR #189), so a fresh clone/redeploy had no campaign dir and readCampaigns returned empty; the board showed nothing. Local working-tree instances still worked. Monorepo intent: p
