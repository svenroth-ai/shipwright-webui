# Shipwright Detective Audit

Generated: 2026-09-29 06:52:14 UTC
Project: `C:/01_Development/shipwright-webui/.worktrees/compliance-findings`

> Cross-artifact consistency scan (plan v7). Surfaces drift classes that
> live between the preventive Canon gate and the reactive Phase-Quality
> Stop hook. See `docs/guide.md` § 4.10 for the 3-layer positioning.

## Summary

| Group | Fail | Skip | Pass |
| ----- | ---: | ---: | ---: |
| A | 0 | 2 | 8 |
| B | 0 | 4 | 3 |
| C | 0 | 1 | 3 |
| D | 0 | 0 | 7 |
| E | 5 | 0 | 4 |
| F | 0 | 0 | 7 |
| G | 0 | 0 | 2 |
| H | 0 | 0 | 7 |
| I | 0 | 0 | 9 |

## Findings

### Preventive re-checks (iterate-12 verifiers, re-run on demand)

- ⏭ **C1** (C, LOW): Spec FR → plan/design coverage
  - design phase never ran (no 'design' among completed phases) — FR→screen mapping not applicable
- ✅ **B3** (B, HIGH): Section test files exist on disk
  - no complete sections to check
- ✅ **B6** (B, HIGH): Section commits reachable in git
  - no section commits to verify
- ✅ **C2** (C, HIGH): Plan FR → spec
  - no plan.md under .shipwright/planning/ — nothing to verify
- ✅ **C3** (C, HIGH): SECTION_MANIFEST ↔ section files
  - no plan.md under .shipwright/planning/ — nothing to verify
- ✅ **C4** (C, HIGH): Section-ID structural validity
  - no plan.md under .shipwright/planning/ — nothing to verify
- ✅ **F2** (F, HIGH): ADR Status in valid enum
  - 307 ADRs, all statuses valid-or-unstated
- ✅ **F3** (F, HIGH): Superseded ADRs reference a replacement
  - 1 supersession ref(s), all resolved
- ✅ **F1** (F, MEDIUM): ADR IDs unique + sequential
  - 307 ADRs, gaps in sequence: [26, 33]

### Detective-only checks (drift classes Phase-Quality can't see)

- ❌ **E1** (E, MEDIUM): RTM stale (regen vs snapshot)
  - first diff at line 3; line delta +11; snapshot 6c30df65e616
  - _Suggested:_ `/shipwright-compliance --fix  # re-renders rtm if a hand-edit drifted it (Group E); if the COMMITTED snapshot is behind instead, commit or stash unrelated work, then /shipwright-compliance --refresh-pr`
- ❌ **E2** (E, MEDIUM): Test-evidence stale
  - first diff at line 3; line delta +11; snapshot 6c30df65e616
  - _Suggested:_ `/shipwright-compliance --fix  # re-renders test_evidence if a hand-edit drifted it (Group E); if the COMMITTED snapshot is behind instead, commit or stash unrelated work, then /shipwright-compliance --refresh-pr`
- ❌ **E3** (E, MEDIUM): Change-history stale
  - first diff at line 3; line delta +7; snapshot 6c30df65e616
  - _Suggested:_ `/shipwright-compliance --fix  # re-renders change_history if a hand-edit drifted it (Group E); if the COMMITTED snapshot is behind instead, commit or stash unrelated work, then /shipwright-compliance --refresh-pr`
- ❌ **E4** (E, MEDIUM): SBOM stale
  - first diff at line 3; snapshot 6c30df65e616
  - _Suggested:_ `/shipwright-compliance --fix  # re-renders sbom if a hand-edit drifted it (Group E); if the COMMITTED snapshot is behind instead, commit or stash unrelated work, then /shipwright-compliance --refresh-pr`
- ❌ **E5** (E, MEDIUM): Dashboard stale
  - first diff at line 3; line delta -2; snapshot 6c30df65e616
  - _Suggested:_ `/shipwright-compliance --fix  # re-renders dashboard if a hand-edit drifted it (Group E); if the COMMITTED snapshot is behind instead, commit or stash unrelated work, then /shipwright-compliance --refresh-pr`
- ⏭ **A4** (A, HIGH): Config path-fields integrity
  - no shipwright_*_config.json with declared path-fields
- ⏭ **A3** (A, MEDIUM): [project.scripts] entry-points resolvable
  - no pyproject.toml files found
- ⏭ **B1** (B, HIGH): Splits-complete have plan_config sections
  - no splits with status=complete in project_config
- ⏭ **B2** (B, HIGH): plan_config sections have files on disk
  - no listed section IDs in plan_config (counts only?)
- ⏭ **B4** (B, HIGH): Completed splits have split_completed events
  - no splits with status=complete
- ⏭ **B5** (B, HIGH): phase_completed events match completed_phase_task_ids
  - run_config schemaVersion != 2 (no phase_tasks shape)
- ✅ **A2** (A, HIGH): Dev-block command refs resolve
  - every dev-block command resolves
- ✅ **A5.2** (A, HIGH): Security workflow YAML parseable
  - workflow YAML parses successfully
- ✅ **A5.3** (A, HIGH): Workflow `permissions:` matches required
  - every required permission set to its documented value
- ✅ **A5.4** (A, HIGH): Critical-gate step carries canonical id
  - critical-gate step carries the canonical id
- ✅ **A5.6** (A, HIGH): Dormant-trigger contract honored
  - `workflow_dispatch:` active; Phase B deliberately activated (a5_phase_b_activated=true) — pull_request, schedule permitted
- ✅ **A5.8** (A, HIGH): Critical-gate behaviorally blocks a critical finding
  - deployed critical-gate blocks on a CRITICAL finding and fails closed on empty/invalid scan output (behavioral probe of the gate shell).
- ✅ **A5.5** (A, MEDIUM): SARIF upload step + category present
  - SARIF upload step uses canonical action and category
- ✅ **A5.7** (A, MEDIUM): Fork-PR guard wired on SARIF upload
  - canonical fork-PR guard pair present in `if:`
- ✅ **B7** (B, MEDIUM): Every commit since release tag has a matching event
  - 69 commit(s) since v0.27.0 (15 excluded by Rules A/B/C, 54 matched events)
- ✅ **D-orphan** (D, MEDIUM): Tests tagged with a removed/absent FR
  - no test is tagged with a removed/absent FR
- ✅ **D2** (D, MEDIUM): Event FR-refs exist in spec
  - every event FR-ref exists in the current spec
- ✅ **D3** (D, MEDIUM): Promised FRs delivered
  - every promised FR was delivered (tested mint or affected_frs event)
- ✅ **D5** (D, MEDIUM): Iterate feature/change events link an FR
  - every feature/change iterate event links an FR
- ✅ **D-layer** (D, LOW): Active FR missing an executed-passing test at a required layer
  - every active FR is covered at its required layers
- ✅ **D1** (D, LOW): Spec FR coverage in events
  - every spec FR has a covering event
- ✅ **D4** (D, LOW): Latest covering event passed tests
  - every covered FR's latest event passed its tests
- ✅ **E?** (E, MEDIUM): session_handoff
  - on-disk matches snapshot 6c30df65e616 (.shipwright/agent_docs/session_handoff.md)
- ✅ **E?** (E, MEDIUM): build_dashboard
  - on-disk matches snapshot 6c30df65e616 (.shipwright/agent_docs/build_dashboard.md)
- ✅ **E?** (E, MEDIUM): triage_inbox
  - on-disk matches snapshot 6c30df65e616 (.shipwright/agent_docs/triage_inbox.md)
- ✅ **E0** (E, LOW): Snapshot baseline
  - baseline snapshot 6c30df65e616
- ✅ **F4** (F, MEDIUM): ADR bloat (> 60 lines without spec_ref)
  - no bloated ADRs without spec_ref
- ✅ **F5** (F, MEDIUM): Arch-impact drops vs architecture.md text
  - all 20 arch-impact drop(s) documented in their target doc
- ✅ **F6** (F, MEDIUM): CLAUDE.md size hygiene
  - CLAUDE.md is 196 lines (≤ 200)
- ✅ **F7** (F, MEDIUM): CLAUDE.md inline iterate-annotation leak
  - 0 inline iterate references (≤ 5)
- ✅ **G2** (G, MEDIUM): Conventional-commit scope matches alias-map / split / stoplist
  - every conventional scope in 67 commit(s) resolves against alias-map / split / stoplist
- ✅ **G3** (G, MEDIUM): Commit-body ADR refs exist in decision_log.md
  - every ADR ref in 8 body-mention(s) is declared
- ✅ **H1** (H, HIGH): Bloat drift (oversize file not in baseline)
  - all 96 oversize file(s) are listed in baseline
- ✅ **H3** (H, HIGH): Bloat anti-ratchet bypass committed
  - no entries with state='anti-ratchet'
- ✅ **H4** (H, HIGH): Bloat exception state without ADR ref
  - all 6 entries with state='exception' carry 'adr'
- ✅ **H5** (H, HIGH): Bloat deferred-plan state without plan_ref
  - no entries with state='deferred-plan'
- ✅ **H0** (H, MEDIUM): Bloat baseline file
  - baseline loaded (107 entries)
- ✅ **H2** (H, MEDIUM): Bloat ratchet-suggestion (baseline current > actual)
  - baseline current matches on-disk LOC for all entries
- ✅ **H6** (H, MEDIUM): Bloat baseline entry missing on disk
  - all baseline entries resolve on disk
- ✅ **I4** (I, MEDIUM): Duplicate FR ID in the catalog
  - no duplicate FR ID(s) found
- ✅ **I5** (I, MEDIUM): Malformed Basis value
  - no malformed Basis value(s) found
- ✅ **I8** (I, MEDIUM): Stale TBD acceptance-criteria placeholder
  - no FR(s) with a TBD placeholder open >= 90 days found
- ✅ **I1** (I, LOW): FR name carries implementation detail
  - no FR name(s) carrying implementation detail found
- ✅ **I2** (I, LOW): FR description carries implementation detail
  - advisory — 3 FR description(s) carrying implementation detail: FR-01.01 (code-symbol), FR-01.10 (iterate-slug), FR-01.70 (code-symbol)
- ✅ **I3** (I, LOW): FR is a change-delta, not a capability
  - no fold candidate(s) found
- ✅ **I6** (I, LOW): FR without acceptance criteria
  - advisory — 12 FR(s) with no acceptance criteria: FR-01.37, FR-01.45, FR-01.47, FR-01.48, FR-01.49 (+7 more)
- ✅ **I7** (I, LOW): FR criterion not in the prescribed Given/when/then shape
  - advisory — 13 FR(s) with a criterion not in Given/when/then shape: FR-01.01, FR-01.05, FR-01.10, FR-01.17, FR-01.28 (+8 more)
- ✅ **I9** (I, LOW): Requirement with no linked rationale (M7 Rewritability)
  - advisory — 5 requirement(s) changed in a run with no decision-drop/ADR of its own (no co-occurring rationale record): FR-01.47, FR-01.48, FR-01.50, FR-01.64, FR-01.65
