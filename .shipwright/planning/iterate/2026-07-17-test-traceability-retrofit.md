# Iterate: test-traceability retrofit (webUI)

- **run_id:** `iterate-2026-07-17-test-traceability-retrofit`
- **Intent:** CHANGE · **Complexity:** medium · **Spec Impact:** NONE (data/tags + docs; product source byte-stable)
- **Risk flags:** `touches_io_boundary` (`shipwright_compliance_config.json` — a `*_config.json` producer/consumer boundary)
- **Handoff:** monorepo campaign `2026-07-15-test-traceability-layers` (anchor `trg-17aaaccd`), runbook `webui-retrofit-brief.md`.

## Goal

Bring webui to the traceability baseline the framework now enforces: tag existing tests with the
FRs they cover, build `test-traceability.json`, and prove the orphan detector fires on webui.

## What was done

1. **Enabling config** — `shipwright_compliance_config.json.traceability.test_roots =
   [server/src, client/src, client/e2e]` + `exclude_dirs = [fixtures, __fixtures__]`. Without it
   the collector scans zero webui roots (webui has no conventional root test dir).
2. **Worktree relocation** — the shared backfill *writer* prunes any `.worktrees/` path, so the
   mandated iterate worktree was moved to `C:/01_Development/wt-traceability-retrofit`
   (pointer updated). Framework follow-on filed (prune by descent, not ancestor).
3. **Tags (1039 written / 1038 bound)** via three deterministic, zero-review signals:
   `unique_commit` (47), co-location import-verified (972), self-listing (20).
4. **Manifest** regenerated — 1038 bindings, 40/66 FRs, layer-aware (unit 1030 / e2e 8).
5. **Live D-orphan proof** — synthetic `@covers FR-01.99` → detector fired MEDIUM → reverted.
6. **Docs** — `.shipwright/compliance/test-traceability-coverage-delta.md` (durable record +
   residue flag + five-target accounting + follow-on handoffs); signal-e prototype preserved at
   `.shipwright/compliance/tools/signal_e_colocation.py`.

Residue (506 files / 3776 cases untagged) is **flagged, not can-kicked**: 483 files are ambiguous
(shared-across-FR dirs — a spec-granularity limit), 23 have no structural signal. Not filed as
3776 cards. See the coverage-delta doc.

## Confidence Calibration

- **Boundaries touched:** `shipwright_compliance_config.json` (config → `test_links` collector);
  test files (additive `// @covers` comments); `.shipwright/compliance/*` (manifest + RTM + doc).
  No product runtime boundary (server/src, client/src app code) touched.
- **Empirical probes run:**
  - Backfill dry-run before any write (counts-first): 47 auto-write, 5 proposals, 0 orphans.
  - Co-location import-verification: **972/972** tags — the test provably imports the FR's source.
  - Manifest round-trip: config present → collector bound **1038** tests (was **0** without it).
  - D-orphan live proof: absent-FR tag → `status=fail severity=MEDIUM (fr_absent)`; after revert
    → `status=pass`, orphans=0.
  - Byte-stability: `git diff origin/main` touches only `*.test/*.spec` + config + `.shipwright/` —
    zero product source; `tsc --noEmit` clean (server+client); full suite green (4940 tests).
- **Test Completeness Ledger:** below — every behavior tagged `tested` with evidence; 0
  untested-testable.
- **Confidence-pattern check:** depth — every co-location/self-listing tag passes 3 hard gates
  (exclusive-owner + exists + imported) and reconciles to the manifest total (no fabricated
  coverage). breadth — all three signals + the residue exhaustively accounted (tagged ∪ ambiguous
  ∪ no-signal ∪ fixtures = 4815). No `cross_component` machinery touched → no integration-coverage
  obligation.

## Test Completeness Ledger

| # | Behavior introduced/changed | Disposition | Evidence |
|---|---|---|---|
| 1 | `traceability.test_roots` makes the collector scan webui's roots | **tested** | manifest bound 1038 tests with config; 0 without (probe) |
| 2 | `unique_commit` tags (47) attribute to the right FR | **tested** | FR-01.30 = "Triage Tab"; introducing commit `290263e9` (triage); 0 wrong on spot-check |
| 3 | co-location tags (972) attribute to the right FR | **tested** | 972/972 import-verified; 8-FR spot-check all correct; total reconciles (47+972+20−1) |
| 4 | self-listing tags (20) attribute to the right FR | **tested** | exclusive spec-listing; e2e coverage 2→8; spot-check (reduced-motion→FR-01.64) |
| 5 | manifest binds tags with layer-aware RTM | **tested** | 1038 bindings, 40 FRs, unit 1030 / e2e 8 |
| 6 | strict D-orphan fires on a tag → absent FR | **tested** | live proof: MEDIUM `fr_absent`; pass after revert |
| 7 | tags are behavior-neutral; product source byte-stable | **tested** | `tsc` clean; 4940 tests green (same counts); diff = comments + config only |
| 8 | signal-e discovery logic (exclusive-owner + import gate) is correct | **tested** | every one of the 992 signal-e outputs gated + reconciled; canonical unit test lands with the monorepo signal-e handoff (follow-on #1) |

## Follow-ons (handoffs, not backlog padding)

1. Add signal-e (co-location + self-listing) to the shared `backfill_test_links` engine (monorepo).
2. `backfill_scan` should prune `.worktrees` by descent so the retrofit runs in-place (monorepo).
3. Finer FR→file attribution (or a multi-FR-per-shared-file convention) for the 483 ambiguous files (webui spec).
