---
canon_generated: true
run_id: "iterate-2026-06-14-terminal-smear-window-focus"
phase: "iterate"
reason: "iterate: terminal repaint on window focus / visibility regain"
timestamp: "2026-06-14T21:46:02.492816+00:00"
---

# Session Handoff

> Auto-generated 2026-06-14 21:46:02 UTC

## Session Info

- **Session ID**: 4f5f8f1a-c38e-40b1-a231-56ae1a515cf5
- **Timestamp**: 2026-06-14 21:46:02 UTC
- **Reason**: iterate: terminal repaint on window focus / visibility regain

## Last Iterate

- **Run ID**: iterate-2026-06-14-tablet-view-polish
- **Date**: 2026-06-14T20:06:37.799524Z
- **Type**: change
- **Complexity**: medium
- **Branch**: iterate/tablet-view-polish
- **ADR**: iterate-2026-06-14-tablet-view-polish
- **Tests passed**: True
- **Spec**: .shipwright/planning/iterate/2026-06-14-tablet-view-polish.md

## Current Iterate Progress

- **Branch**: iterate/terminal-smear-window-focus
- **Run ID**: iterate-2026-06-14-terminal-smear-window-focus
- **Spec**: .shipwright/planning/iterate/2026-06-14-terminal-smear-window-focus.md
- **Complexity**: medium (escalated from `small`: load-bearing webgl renderer / claude.md rule 22, cross-cutting across every navigation path, user-requested multi-scenario verification)
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

- **Branch**: iterate/terminal-smear-window-focus
- **Last Commit**: 085d605 fix(responsive): tablet-view polish — collapsible rail, bottom safe-area, greedy list title, terminal touch-scroll (FR-01.38) (#145)
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
| evt-c97442f3 | work_completed | iterate (Repaint embedded terminal on window focus / visibility regain — fixes WebGL stale-frame smear that previously only a manual resize healed) | 2026-06-14 |
| evt-7619adfd | work_completed | iterate (Tablet-view polish: bidirectional sidebar rail collapse, bottom safe-area inset, greedy list Title column, terminal touch-action:none) | 2026-06-14 |
| evt-0ea5c081 | work_completed | iterate (Self-heal ~/.claude.json a second time at deploy END (post server-up), not only at Step 0) | 2026-06-14 |
| evt-efee2359 | work_completed | iterate (Compliance detective-audit reconcile (D3/G2/H1): G2 add 'responsive' commit scope to audit_config.json g2_stoplist; D3 reaffirm promised FR-01.38/FR-01.39 via event_amended on the tablet/phone responsive iterate events (their own work_completed omitted affected_frs); H1 grandfather client/src/components/terminal/EmbeddedTerminal.tsx (311>300, ADR-097 deep module) in shipwright_bloat_baseline.json. No product code touched; D3/G2/H1 re-run FAIL->PASS.) | 2026-06-14 |
| evt-29378060 | event_amended | — | 2026-06-14 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 225
- **Last iterate**: bug — Repaint embedded terminal on window focus / visibility regain — fixes WebGL stale-frame smear that previously only a manual resize healed (2026-06-14)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-170: Project Campaigns-board status from the tracked event log
- **Date:** 2026-06-11
- **Section:** shipwright-webui / Campaigns lane (FR-01.31)
- **Run-ID:** iterate-2026-06-11-campaign-events-projection
- **Context:** Campaign planning dirs (campaign.md + status.json) are gitignored/local-only (webui PR #121, monorepo PR #189), so a fresh clone/redeploy had no campaign dir and readCampaigns returned empty; the board showed nothing. Local working-tree instances still worked. Monorepo intent: p
