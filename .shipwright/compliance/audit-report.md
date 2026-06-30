# Shipwright Detective Audit

Generated: 2026-05-22 08:29:41 UTC
Project: `C:/01_Development/shipwright-webui`

<!-- shipwright:audit-staleness:start -->
> ⚠️ **Possibly stale — re-run `/shipwright-compliance`.** This detective audit was generated 2026-05-22 08:29:41 UTC; routine compliance regens refresh the dashboard but do **not** re-run the audit, so the findings below may already be resolved. Compare the `Generated:` line above with the dashboard's.
<!-- shipwright:audit-staleness:end -->

> Cross-artifact consistency scan (plan v7). Surfaces drift classes that
> live between the preventive Canon gate and the reactive Phase-Quality
> Stop hook. See `docs/guide.md` § 4.10 for the 3-layer positioning.

## Summary

| Group | Fail | Skip | Pass |
| ----- | ---: | ---: | ---: |
| A | 0 | 2 | 7 |
| B | 1 | 4 | 2 |
| C | 0 | 0 | 4 |
| D | 0 | 3 | 2 |
| E | 0 | 0 | 5 |
| F | 4 | 0 | 3 |
| G | 0 | 0 | 2 |

## Findings

### Preventive re-checks (iterate-12 verifiers, re-run on demand)

- ✅ **B3** (B, HIGH): Section test files exist on disk
  - no complete sections to check
- ✅ **B6** (B, HIGH): Section commits reachable in git
  - no section commits to verify
- ✅ **C1** (C, HIGH): Spec FR → plan/design coverage
  - no planning FRs — coverage trivially satisfied
  - _Suggested:_ `/shipwright-iterate --type change "reconcile C1 (Spec FR → plan/design coverage) — see .shipwright/compliance/audit-report.md"`
- ✅ **C2** (C, HIGH): Plan FR → spec
  - no plan.md under .shipwright/planning/ — nothing to verify
  - _Suggested:_ `/shipwright-iterate --type change "reconcile C2 (Plan FR → spec) — see .shipwright/compliance/audit-report.md"`
- ✅ **C3** (C, HIGH): SECTION_MANIFEST ↔ section files
  - no plan.md under .shipwright/planning/ — nothing to verify
  - _Suggested:_ `/shipwright-iterate --type change "reconcile C3 (SECTION_MANIFEST ↔ section files) — see .shipwright/compliance/audit-report.md"`
- ✅ **C4** (C, HIGH): Section-ID structural validity
  - no plan.md under .shipwright/planning/ — nothing to verify
  - _Suggested:_ `/shipwright-iterate --type change "reconcile C4 (Section-ID structural validity) — see .shipwright/compliance/audit-report.md"`
- ✅ **F2** (F, HIGH): ADR Status in valid enum
  - 113 ADRs, all statuses valid-or-unstated
- ✅ **F3** (F, HIGH): Superseded ADRs reference a replacement
  - 1 supersession ref(s), all resolved
- ✅ **F1** (F, MEDIUM): ADR IDs unique + sequential
  - 113 ADRs, gaps in sequence: [26, 33]

### Detective-only checks (drift classes Phase-Quality can't see)

- ❌ **B7** (B, MEDIUM): Every commit since release tag has a matching event
  - 14 commit(s) since v0.14.0 have no matching event: de956bce, c8a28d1b, c9b662b8, 63859305, eaeeb452, (+9 more)
  - _Suggested:_ `/shipwright-iterate --type change "reconcile B7 (Every commit since release tag has a matching event) — see .shipwright/compliance/audit-report.md"`
- ❌ **F4** (F, MEDIUM): ADR bloat (> 60 lines without spec_ref)
  - 5 ADR(s) exceed 60 lines without a spec_ref link — refactor each into .shipwright/planning/adr/<NNN>-<slug>.md and link via --spec-ref. Heaviest: ADR-058 (129 lines), ADR-099 (123 lines), ADR-095 (107 lines), ADR-096 (97 lines), ADR-098 (77 lines).
- ❌ **F5** (F, MEDIUM): Architecture marker vs arch-impact drops
  - architecture.md has no shipwright:architecture marker, but 1 arch-impact drop(s) exist — run the first sync to establish a baseline. Drops: iterate-2026-05-21-triage-fix-now-and-phase-slash_001.json.
- ❌ **F6** (F, MEDIUM): CLAUDE.md size hygiene
  - CLAUDE.md is 270 lines, exceeds the 200-line hygiene cap — consider moving per-iterate detail into .shipwright/planning/adr/<NNN>-<slug>.md spec files.
- ❌ **F7** (F, MEDIUM): CLAUDE.md inline iterate-annotation leak
  - 8 inline 'Iterate X (ADR-NN)' references in CLAUDE.md exceed the 5-reference cap — move per-iterate detail into .shipwright/planning/adr/<NNN>-<slug>.md spec files. Sample: ['Iterate 5', 'Iterate 3', 'Iterate 3'].
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
- ⏭ **D2** (D, MEDIUM): Event FR-refs exist in spec
  - no FR table rows in any spec.md
- ⏭ **D1** (D, LOW): Spec FR coverage in events
  - no FR table rows in any spec.md
- ⏭ **D4** (D, LOW): Latest covering event passed tests
  - no FR table rows in any spec.md
- ✅ **A2** (A, HIGH): Dev-block command refs resolve
  - every dev-block command resolves
- ✅ **A5.2** (A, HIGH): Security workflow YAML parseable
  - workflow YAML parses successfully
- ✅ **A5.3** (A, HIGH): Workflow `permissions:` matches required
  - every required permission set to its documented value
- ✅ **A5.4** (A, HIGH): Critical-gate step carries canonical id
  - critical-gate step carries the canonical id
- ✅ **A5.6** (A, HIGH): Dormant-trigger contract honored
  - `workflow_dispatch:` active; pull_request/schedule dormant
- ✅ **A5.5** (A, MEDIUM): SARIF upload step + category present
  - SARIF upload step uses canonical action and category
- ✅ **A5.7** (A, MEDIUM): Fork-PR guard wired on SARIF upload
  - canonical fork-PR guard pair present in `if:`
- ✅ **D3** (D, MEDIUM): Promised FRs delivered
  - every promised FR has a follow-up affected_frs event
- ✅ **D5** (D, MEDIUM): Iterate feature/change events link an FR
  - every feature/change iterate event links an FR
- ✅ **E1** (E, MEDIUM): RTM stale (regen vs on-disk)
  - on-disk matches fresh regeneration (.shipwright/compliance/traceability-matrix.md)
- ✅ **E2** (E, MEDIUM): Test-evidence stale
  - on-disk matches fresh regeneration (.shipwright/compliance/test-evidence.md)
- ✅ **E3** (E, MEDIUM): Change-history stale
  - on-disk matches fresh regeneration (.shipwright/compliance/change-history.md)
- ✅ **E4** (E, MEDIUM): SBOM stale
  - on-disk matches fresh regeneration (.shipwright/compliance/sbom.md)
- ✅ **E5** (E, MEDIUM): Dashboard stale
  - on-disk matches fresh regeneration (.shipwright/compliance/dashboard.md)
- ✅ **G2** (G, MEDIUM): Conventional-commit scope matches alias-map / split / stoplist
  - every conventional scope in 17 commit(s) resolves against alias-map / split / stoplist
- ✅ **G3** (G, MEDIUM): Commit-body ADR refs exist in decision_log.md
  - every ADR ref in 22 body-mention(s) is declared
