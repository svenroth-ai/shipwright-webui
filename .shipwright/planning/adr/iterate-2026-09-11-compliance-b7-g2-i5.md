# ADR: Reconcile B7/G2/I5 compliance findings

**Run-ID:** iterate-2026-09-11-compliance-b7-g2-i5
**Date:** 2026-09-11

## Context

Detective audit flagged three open findings:

- **B7** (Every commit since release tag has a matching event): commit
  `1a0cbc58` (PR #456, `fix(main): restore TaskBoardPage.tsx bloat-baseline
  entry to 446`) has no matching `shipwright_events.jsonl` row.
- **G2** (Conventional-commit scope matches alias-map / split / stoplist):
  `5ccd8165` (scope `leadwright`, PR #457) and `81cb38b5` (scope `a11y`,
  PR #454) use scopes not yet in `audit_config.json`'s `g2_stoplist`.
- **I5** (Malformed Basis value): all 33 FR rows in
  `.shipwright/planning/01-adopted/spec.md` carried a legacy
  provenance-trail `Basis` cell (e.g. `crawl+enrichment,
  iterate-2026-07-09-w3, iterate-2026-09-01-lead-board-surface, ...`)
  instead of a bare value from the closed vocabulary
  (`interview | code | observed | tests | assumed | other`,
  `shared/fr-authoring.md` §4a). This predates the `Basis` vocabulary rule
  (campaign "Requirements Catalog", sub-iterate S5) — the cells still carry
  the older `crawl`/`ast`/`enrichment` adoption-detection tags plus an
  ever-growing list of iterate slugs appended by later touches, never
  normalized to the new vocabulary.

## Decision

**B7:** backfilled one `work_completed` event for `1a0cbc58` via
`record_event.py` (`change_type=infra`, `spec_impact=none`) — a baseline-value
bookkeeping repair, no requirement changed.

**G2:** added `leadwright` and `a11y` to `g2_stoplist` in `audit_config.json`,
with a dated rationale entry in `_g2_stoplist_comment`, matching the existing
per-scope entry convention used by every prior reconciliation.

**I5:** normalized every malformed `Basis` cell to the bare value `code`,
dropping the iterate-slug provenance trail. `code` was chosen because every
row's actual provenance — `/shipwright-adopt`'s crawl/AST source-reading
detection, or later code-grounded iterate work — is "read from source"
per `fr_basis.py`'s vocabulary table, never an interview, a live-application
observation, or an unconfirmed assumption. `fr-authoring.md` §2/§4a
explicitly excludes iterate slugs from `Basis` ("those go to the acceptance
criteria or `architecture.md`, not to `Basis`"), and the dropped history is
not lost: each affected row's Description already carries a prose
`**Updates:**` narrative of the same iterates.

## Consequences

All 3 findings verified fixed via a fresh detective audit re-run scoped to
B,G,I (17 checks: 13 pass, 4 skip, 0 fail — was 3 fail). No application code
touched (`server/`, `client/` diff is empty); full server + client test
suites and typechecks re-verified green at F0.

## Rejected alternatives

Per-row semantic Basis classification (mapping `crawl`→`observed`,
`ast`→`code`, `enrichment`→case-by-case) was considered and rejected: the
distinction is not evidenced in the historical data (no row records which
signal actually grounded it), so a per-row guess would fabricate precision
the source data does not support. A uniform, defensible `code` classification
is honest about what is actually known.
