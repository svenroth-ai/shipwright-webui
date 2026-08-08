# Triage amend event support (reader parity + Edit-in-place UI)

Full detail — Acceptance Criteria, Design Notes, Affected Boundaries,
Confidence Calibration (empirical probes + Test Completeness Ledger), and
the complete Review Findings Disposition table (code-reviewer, doubt-
reviewer, and three rounds of external review, each finding marked
accepted-and-fixed or rejected-with-reason) — lives in the iterate spec:

[`.shipwright/planning/iterate/2026-08-08-triage-amend-reader.md`](../iterate/2026-08-08-triage-amend-reader.md)

## Summary

The WebUI triage reader (`server/src/core/triage-store.ts`) resolved
`append` and `status` events but silently ignored the `amend` event type
(shipped in PR #609) — an amended triage card displayed its pre-amend
content with no error and no visible sign a correction existed.

This run:

1. Ported the `amend` overlay (`triage-amend.ts`, a TS mirror of
   `shared/scripts/lib/triage_amend.py`) into the reader's existing
   `(ts, file-order)`-sorted Pass 2, alongside `status` — cross-language
   parity verified against regenerated Python fixtures.
2. Added a delta-only write path (`appendAmendEvent`,
   `POST /api/triage/:projectId/amend`) and an Edit-in-place UI: a header
   pencil icon-button toggles the title/severity/detail block between read
   display and an inline `TriageAmendForm`, gated to `status === "triage"`.
3. Removed `LaunchPayloadBlock` (dead — Fix-now is the only launch
   affordance actually used).

## Notable review-cascade findings (see the spec's Review Findings
## Disposition table for the full list)

- A real lost-update bug (doubt-reviewer): `TriageAmendForm` diffed its
  local field state against the *live*, polling `item` prop instead of a
  mount-time snapshot, so a concurrent amend elsewhere could be silently
  reverted by an unrelated save. Fixed via an `initialItem` snapshot.
- An AC9 "fail toward disclosure" violation introduced by this run's own
  first performance fix: a TTL cache on the route-to-outbox git probe
  could serve a stale `true` for up to 5s after a branch switch,
  suppressing the disclosure banner exactly when it exists to fire.
  Replaced with an uncached, async (`execFile`) probe — no staleness
  window, no event-loop blocking.
- One external-review finding (round 3) was **rejected-with-reason**:
  `applyAmend` collapsing a non-string `by`/`ts` to `null` is not a
  WebUI-introduced defect — it mirrors the canonical Python
  `triage_amend.py apply_amend`'s own, already Stage-3-doubt-reviewed
  behavior. "Fixing" it would break cross-language parity rather than
  preserve it.
