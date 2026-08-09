# Mini-Plan: triage-amend-reader

- **Run ID:** iterate-2026-08-08-triage-amend-reader

## 1. Files to create/modify

**Step 1 (reader — correctness, shippable alone):**
- `server/src/core/triage-amend.ts` (NEW) — TS port of `lib/triage_amend.py`:
  `AMENDABLE_FIELDS`, `AMENDED_BY_FIELD`/`AMENDED_AT_FIELD`, `validateAmendEvent`,
  `applyAmend`, `tryApplyAmend`, `suggestPriorityFromSeverity` (port of
  `triage_fields.suggest_priority_from_severity`), `checkAmendFields` (write-side
  validation, used by Step 2).
- `server/src/core/triage-store.ts` (MODIFY) — `resolveUnion`: merge the
  separate status-events array into one `status`+`amend` array sorted by
  `(ts, file-order)`; dispatch per event type (status branch unchanged; amend
  branch delegates to `triage-amend.ts`'s `tryApplyAmend`). Pass 1 also
  initializes `amendedBy`/`amendedAt = null`.
- `server/src/types/triage.ts` (MODIFY) — `TriageItem` gains
  `amendedBy: string | null`, `amendedAt: string | null`; new
  `TriageAmendEvent` wire type mirroring `TriageStatusEvent`.
- `server/src/test/fixtures/triage.jsonl` (MODIFY) — append two items:
  one with two sequential amends (accumulate, later wins per field), one
  with an amend interleaved with a status flip (true ts-order test).
- `server/src/test/fixtures/triage-resolved.json` (REGEN via
  `server/scripts/regen-triage-fixtures.py`, which shells out to the real
  `shared/scripts/triage.py` — this is the parity oracle, not hand-written).
- `server/src/core/triage-store.test.ts` (MODIFY) — parity assertions over
  the new fixture rows + hand-written TS-only cases (invalid-field skips
  whole event, severity recomputes priority, `ts` untouched by amend).
- `server/src/core/triage-amend.test.ts` (NEW) — unit tests for the pure
  module in isolation.

**Checkpoint — Step 1 must be green (build + test) before Step 2 starts.**
Mirrors the filing card: Step 1 alone is a complete, shippable correctness
fix; Step 2 depends on it and is actively harmful shipped without it.

**Step 2 (writer — the Edit UI action):**
- `server/src/core/triage-write.ts` (MODIFY) — add `appendAmendEvent(args)`,
  structurally mirroring `appendStatusEvent` (residence-derived write target,
  header bootstrap, newline guard, cache invalidation). Residence logic is
  duplicated inline rather than extracted into a shared helper — mirrors
  `triage_amend.resolve_amend_residence`'s own docstring ("the SAME logic in
  two places today — a deliberately deferred dedup, not an oversight").
- `server/src/core/triage-validation.ts` (MODIFY) — add `parseAmendBody`:
  at least one of title/detail/severity present (contentless → 400 before
  any I/O), each present field validated (non-blank title, string detail,
  known severity).
- `server/src/routes/triage.ts` (MODIFY) — new
  `POST /:projectId/:id/amend` handler, same shape as the existing
  Dismiss/Snooze handler (lock → existence check → residence → write →
  cache invalidate → response).
- `server/src/routes/triage.test.ts` (MODIFY) — amend route matrix: happy
  path (single field, multi field), contentless 400, unknown id 404,
  invalid severity 400, lock contention 503.
- Client triage API module (exact file TBD at build time — grep the existing
  `dismissTriageItem`/`snoozeTriageItem` client calls) (MODIFY) — add
  `amendTriageItem()`.
- `client/src/components/triage/TriageAmendForm.tsx` (NEW) — title/detail/
  severity form; delta-only submit (only touched fields sent); submit
  disabled until dirty; Cancel discards edits and returns to read view.
  New file, not grown into `TriageDetailModal.tsx`, which sits 1 line under
  its documented bloat-baseline ceiling (374/375) even before this change.
- `client/src/components/triage/TriageDetailModal.tsx` (MODIFY) —
  (1) remove the `LaunchPayloadBlock` import + render (operator decision,
  2026-08-08 — see Spec Impact REMOVE); (2) add a pencil icon-button in the
  header row (beside `Dialog.Title`/Close), gated `status === "triage"`,
  toggling `editing` state; (3) when `editing`, render `<TriageAmendForm>`
  in place of the title/severity-badge/detail read block — the existing
  Fix-now/Dismiss/Snooze/Promote row and the Reason/Revisit fields are
  UNTOUCHED (Edit is deliberately not a fifth button in that row — see the
  spec's Design Notes); (4) render an "Last edited by X · <relative time>"
  subtitle when `amendedBy`/`amendedAt` are set, always visible (not only
  while editing) so history stays visible per Decision (a).
- `client/src/components/triage/LaunchPayloadBlock.tsx` (DELETE) — confirmed
  by grep: `TriageDetailModal.tsx` is its only consumer (one comment
  mentions `launchPayload` but does not import the component).
- `client/src/components/triage/LaunchPayloadBlock.test.tsx` (DELETE)
- `client/src/lib/launchPayload.ts` (DELETE) — `stripControlChars`,
  confirmed used ONLY by `LaunchPayloadBlock.tsx`; orphaned once that's
  gone. The `TriageItem.launchPayload` WIRE field itself stays (parity
  field from the producer contract, unrelated to this UI-only removal).
- `client/src/lib/launchPayload.test.ts` (DELETE)
- `client/src/test/fixtures/launch-payload-strip.json` (DELETE) — fixture
  used only by the deleted test above.
- `client/src/components/triage/TriageAmendForm.test.tsx` (NEW)
- `client/src/components/triage/TriageDetailModal.test.tsx` (MODIFY) — drop
  the LaunchPayloadBlock-render assertions, add pencil-toggle + inline-form
  + provenance-subtitle assertions.
- `client/e2e/flows/triage-amend.spec.ts` (NEW) — real built stack: open a
  card, click the pencil icon, edit title, Save, see it update in place with
  the "last edited" subtitle shown.
- `.shipwright/planning/01-adopted/spec.md` (MODIFY, FR-01.30) — append
  `(E)` ACs + `(T)` test rows for Amend, following the exact pattern of
  every prior triage-subsystem MODIFY entry in that section; move the
  LaunchPayloadBlock-specific ACs to `### Removed Requirements` with
  `status: deprecated` (Fix-now's own ACs stay — untouched, separate CTA).

## 2. Work breakdown (sequential)

1. `triage-amend.ts` pure module + its own unit tests (TDD red/green,
   no I/O, ports the Python module 1:1).
2. `triage-store.ts` wiring + `types/triage.ts` extension + fixture cases +
   regen + parity assertions. **This completes Step 1.**
3. Run the full server test suite + a manual read-path sanity check before
   touching Step 2 (checkpoint above).
4. `triage-write.ts` `appendAmendEvent` + `triage-validation.ts`
   `parseAmendBody` + the new route + route tests.
5. Client API call + `TriageAmendForm.tsx` + `TriageDetailModal.tsx` wiring +
   component tests.
6. E2E spec (`triage-amend.spec.ts`).
7. `spec.md` FR-01.30 MODIFY (ACs + T rows) — Step 2 of the skill's Spec
   Update process.

## 3. Component hierarchy (UI)

```
TriagePage → PerProjectTriageSection → TriageItemCard → (click)
  → TriageDetailModal → TriageAmendForm (new)
```

## 4. Data model changes

None. `triage.jsonl` is an append-only JSONL event log, not a DB table — no
migrations, no RLS.

## 5. Test strategy

Unit: `triage-amend.ts`, `triage-store.ts` (parity + TS-only edge cases),
`triage-write.ts`, `triage-validation.ts`, route matrix, component tests
(form validation, provenance render, branch-warning banner).
E2E: one new spec against the real built stack (Step 2's live surface).
No integration/pgTAP layer — no DB involved.

## 6. Alternative approach (rejected)

**Considered:** fold the amend overlay directly into `triage-store.ts`'s
existing status-overlay loop, with no separate `triage-amend.ts` module.

**Rejected because:** `triage-store.ts` is already at its documented
bloat-baseline ceiling with thin headroom (recorded 305 / actual 277 = 28
lines free), and the amend logic (validation + apply + priority-recompute +
two new field constants) is comfortably larger than that. The Python side
made the *identical* extraction for the *identical* reason — see
`lib/triage_amend.py`'s own header: "Relocated out of `shared/scripts/
triage.py` ... to make room under that file's bloat-baseline ceiling." A TS
module split into the same boundary keeps the two languages' module
structure congruent, which is a standing convention for this cross-language
contract (see the parity-fixture drift-guard header in
`server/src/types/triage.ts`), not a cost specific to this one change.
