# Iterate Spec — BP-1 WebUI traceability backfill

- **run_id:** iterate-2026-06-28-bp1-webui-fr-backfill
- **intent:** change (compliance / traceability data)
- **complexity:** medium (spans the whole event log + RTM; `touches_io_boundary`; public-facing Control Grade)
- **spec impact:** NONE — no `spec.md` FR definition changes; only event→FR links + regenerated RTM/dashboard.

## Context

This is the **WebUI-repo data side of BP-1** (campaign `2026-06-27-compliance-control-coverage`,
triage `trg-7ac99582`). The code/mechanism half ships shared from the monorepo plugins
(#277 AR-01/02/03 — control_grade.py / latest-suite resolver / inline audit), so there is
**no WebUI code or test change** here.

Baseline (after syncing the post-#277 plugin cache and regenerating with the now-shared
plugin): **Control Grade B (85/100)**, capped *solely* by the requirement-traceability
dimension — `req_score = 0.6·coverage + 0.4·tag_rate`, with **27/41 FRs covered** and
**110/245 changes FR-tagged**. Every other measurable dimension is green; change-reconciliation
(needs BP-2, monorepo/shared) and security (CI gate, AR-10) are correctly `n/a`.

Two gaps fed the cap:
- **69 `work_completed` events were unclassified** (no `affected_frs`, no `none_reason`).
- **14 FRs were NOT-VERIFIED** (untraced) — all foundational *adopted* endpoints/pages,
  most of which already have real test coverage. The gap was **linking, not testing**.

## Approach (honest, no fabricated coverage)

1. **Classify all 245 work events.** Append `event_amended` overlays so each previously-untagged
   event carries either `affected_frs` (work that exercised the FR — terminal→FR-01.28,
   resume-CTA→FR-01.02, network-profile→FR-01.31, board→FR-01.01, …) or an explicit
   `none_reason` + `change_type` (docs / tooling / compliance / merge). Result: 45 FR-tagged
   + 24 `none_reason`, **0 untagged**.
2. **Group A — close 5 NOT-VERIFIED FRs with clean event-level evidence** by amending the
   *existing* work event whose change exercised the endpoint:
   FR-01.23←dynamic-stack-profiles, FR-01.05←diagnostics-page cleanup,
   FR-01.06/.25/.27←ActionsConfig/ProjectSettings/upload work.
3. **Group B — verify the remaining 9 NOT-VERIFIED endpoints by re-running their existing
   route tests** (server 1671 + client 1793 = 3464/3464 green) and linking that fresh
   verification on this iterate's own `work_completed` event:
   FR-01.07/.14/.17/.18/.19/.20/.21/.22/.26.
4. Regenerate RTM + dashboard.

**Rejected:** force-covering via `routes.ts` file co-location (dishonest — co-located ≠
exercised); leaving Group B NOT-VERIFIED (real tests exist; verify-and-link is more accurate).

## Acceptance Criteria

1. All 245 pre-existing `work_completed` events are FR-classified — **0 untagged**.
2. `event_amended` overlays round-trip via `apply_amendments` so compliance reads the
   corrected `affected_frs` (touches_io_boundary boundary probe).
3. RTM regenerates with **0 NOT-VERIFIED** requirements; **41/41 FRs covered**.
4. Control Grade recomputes **A (95/100)** from the backfilled inputs (B 85 → A 95).
5. The 9 Group-B endpoints pass their existing route tests (3464/3464 green).

## Spec Impact

**NONE** — behavior-preserving for the WebUI application; this iterate changes only
`.shipwright/` governance artifacts (event log + regenerated RTM/dashboard) and
`agent_docs/conventions.md`. No `spec.md` FR text changes.

## Confidence Calibration

- **Boundaries touched:** `shipwright_events.jsonl` (append-only event log, amended via
  `event_amended` overlay); `.shipwright/compliance/{traceability-matrix,dashboard,...}.md`
  (regenerated); `shipwright_test_results.json`; `agent_docs/conventions.md`. No client/server code.
- **Empirical probes run:**
  - Fold probe — `apply_amendments` over the backfilled log → `work_completed` untagged **0**
    (tagged 156 / none_reason 89); Group-A FRs present on their targets; iterate event carries
    the 9 Group-B FRs.
  - Compliance regen probe — `update_compliance --phase iterate` → RTM `NOT VERIFIED` count **0**,
    dashboard Control Grade **A (95/100)**, traceability **41/41 covered, 157/246 FR-tagged**.
  - Test-run probe — `vitest run` server **1671/1671** + client **1793/1793** = **3464/3464**
    green, including every Group-B route test (index/inbox/preview/run-config/tree/file/actions/
    diagnostics/settings).
- **Test Completeness Ledger:** 5 testable behaviors, all `tested` with evidence, 0 untested-testable
  (machine-readable block in `shipwright_test_results.json.iterate_latest.test_completeness`).
- **Confidence-pattern check:** depth — the grade is recomputed from the regenerated artifacts,
  not asserted; breadth — coverage spans the full 245-event log + all 41 FRs + both test suites.
  No `cross_component` framework machinery is touched (data-only; the resolver/mechanism is
  monorepo/shared), so no integration-composition behavior is required.
