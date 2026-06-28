# Iterate Spec — WebUI compliance reformat + reconciliation → A

- **run_id:** iterate-2026-06-28-webui-compliance-reformat
- **intent:** change (compliance regeneration + reconciliation data)
- **complexity:** medium (`touches_io_boundary`: event log + compliance docs; public-facing Control Grade)
- **spec impact:** NONE — no `spec.md` or webui code/test change.

## Context

The WebUI dashboard committed by #178 was generated while the plugin cache stood at **#279** —
*before* cc1 (BP-1 traced-credit), cc2 (BP-2 reconciliation), cc3 (AR-05 RTM "Reconciled?"
column). So it carried the old Control-Grade rendering **and an inflated A95**: the old scorer
did not measure the **Change-reconciliation** dimension at all.

Regenerating with the now-current plugin (#286) revealed the honest baseline: **B (89/100)**,
capped by Change reconciliation — **12/22 behavior-touched FRs had never been re-verified after
their change** (BP-2 derives this from event `spec_impact`, no `fr_impact` needed).

## Approach (honest, no fabricated coverage)

1. **Regenerate** all compliance docs with the current plugin → new Control-Grade block,
   "traced (FR-linked or classified no-FR)" wording, RTM "Reconciled?" column, SBOM.
2. **Reconcile** the 12 behavior-touched-but-unreconciled FRs honestly: re-ran the **full test
   suite (server 1671 + client 1793 = 3464/3464 green)**, which re-verifies their behaviors, and
   linked that fresh verification on this iterate's own `work_completed` event (`affected_frs` =
   the 12 FRs, `spec_impact=none` so no *new* behavior touch is created — a tested event
   referencing an FR after its last touch reconciles it per BP-2).

**Deferred (separate follow-up):** AR-10 CI-security wiring — the webui `security.yml` is the
pre-AR-10 version (uploads SARIF only, no `findings.json`), so the Security dimension stays
`n/a`. Because `n/a` is excluded from the Scorecard denominator, this does **not** lower the
grade. Lighting it requires upgrading `security.yml` to the AR-10 `findings.json` contract
(sensitive path → Tier-3 review) — out of scope here.

## Acceptance Criteria

1. Compliance docs regenerate with the current plugin (new Control-Grade block + RTM
   "Reconciled?" column).
2. All 22 declared behavior-touched FRs are reconciled (re-verified) → reconciliation **✅ 0/22**.
3. Control Grade rises from the honest stale-plugin **B89 → A** (≥90).
4. No webui code or test change; the 3464-test suite is green.

## Spec Impact

**NONE** — changes only `.shipwright/` governance artifacts (event log + regenerated
RTM/dashboard/SBOM). No `spec.md` FR text, no webui source/test.

## Confidence Calibration

- **Boundaries touched:** `shipwright_events.jsonl` (one `work_completed` reconciliation event);
  `.shipwright/compliance/{dashboard,traceability-matrix,sbom,test-evidence,change-history}.md`
  (regenerated). No client/server code.
- **Empirical probes run:**
  - Suite probe — `vitest run` server **1671/1671** + client **1793/1793** = **3464/3464** green.
  - Reconciliation probe — `compute_reconciliation` over the post-event log → **0/22**
    behavior-touched FRs unreconciled (was 12/22).
  - Regen probe — regenerated dashboard → **Control Grade A (98/100)**; reconciliation ✅,
    traceability ✅ 41/41 covered.
- **Test Completeness Ledger:** 4 testable behaviors, all `tested` with evidence, 0
  untested-testable (machine-readable in `shipwright_test_results.json.iterate_latest.test_completeness`).
- **Confidence-pattern check:** depth — the grade + reconciliation are recomputed from the
  regenerated artifacts, not asserted; breadth — the suite re-verifies all behavior-touched FRs.
  No `cross_component` framework machinery touched (data-only).
