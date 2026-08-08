# Iterate Spec: triage-amend-reader

- **Run ID:** iterate-2026-08-08-triage-amend-reader
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal
The WebUI triage reader (`server/src/core/triage-store.ts`) resolves `append`
and `status` events but silently ignores the `amend` event type shipped in
PR #609 (2026-08-08) — an amended triage card displays its pre-amend content
with no error and no visible sign a correction exists. Fix the reader to
match the canonical Python `triage.read_all_items` (parity), then add the
operator-facing Edit action that emits `amend` events, so a card can be
corrected in place instead of dismiss-and-refile.

## Acceptance Criteria
- [x] AC1: `readAllItems()` overlays a valid `amend` event's present fields
      (title/detail/severity/kind) onto the resolved item, in the SAME single
      `(ts, file-order)`-sorted pass as `status` events (not two separate
      passes) — matching `triage.py read_all_items` Pass 2 exactly.
- [x] AC2: A `severity` amend recomputes `suggestedPriority`; a `kind` amend
      changes only `kind` (`suggestedDomain` derives from `source`, which is
      not amendable, so it is never recomputed).
- [x] AC3: `item.ts` is never touched by an amend (stays "time of the last
      status decision"); `amendedBy`/`amendedAt` are set from a landing amend
      and stay `null` until one lands.
- [x] AC4: An amend event with any invalid PRESENT field (blank title,
      non-string detail, unknown severity/kind) is skipped WHOLE — no partial
      application, mirroring the existing damaged-`status`-event convention.
- [x] AC5: Two amends on the same item accumulate (later `ts` wins per field;
      an absent field on the later amend leaves the earlier value untouched);
      an amend interleaved with a status flip resolves in true
      `(ts, file-order)` order regardless of event type.
- [x] AC6: TS `readAllItems()` deep-equals the Python `read_all_items()`
      fixture output including both new cases (regenerated via
      `regen-triage-fixtures.py` against the real `shared/scripts/triage.py`).
- [x] AC7: `POST /api/triage/:projectId/amend` (`triageId` in the JSON body,
      matching the existing `/dismiss` and `/snooze` convention — not a URL
      path param) lets the operator submit a delta (any subset of
      title/detail/severity) that is appended as an `amend` event via the
      same residence-derived (tracked-preferred) write target as status
      flips; a contentless body is rejected `400` before any write; amending
      an item whose status is not `triage` is rejected `409` (edit is
      in-scope only for open triage cards — AC8).
- [x] AC8: The Triage Detail modal gains an Edit action, placed as a
      pencil-style icon-button in the modal HEADER (beside the title / Close
      control) — not a fifth button in the existing Fix-now/Dismiss/Snooze/
      Promote row, because Edit corrects the record in place while that row
      transitions status; mixing the two kinds of action in one row would
      make the row read as "five things that all happen when you click",
      which they don't. Clicking it swaps the title/severity/detail display
      into an inline form (Save/Cancel); on success the resolved card updates
      in place and shows "last edited" provenance (`amendedBy`/`amendedAt`)
      as a subtitle line without hiding the resolved values (resolved state
      prominent, history available per the filing card's Decision a). Only
      title/detail/severity are editable (Decision, "Out of Scope" below);
      only shown while `status === "triage"`, matching the existing
      Reason/Revisit/action-row visibility gate — editing a dismissed/
      promoted/parked item is out of scope for this run.
- [x] AC9: When the write would land on the TRACKED store because HEAD is not
      the default branch, the Edit UI discloses this to the operator BEFORE
      submitting, not after (Decision c).
- [x] AC10: `LaunchPayloadBlock` (the informational pasted-command box for
      `source === "github"` items) is removed from the detail modal — dead
      per operator decision (2026-08-08): Fix-now is the only launch
      affordance actually used; the raw payload text was purely
      informational and never acted on. The component, its test file, and
      its FR-01.30 ACs are struck through with a "Superseded" note, following
      the codebase's existing removal convention (spec.md line ~273, ADR-068-
      A1's clipboard-write ritual) rather than inventing a new "Removed
      Requirements" section — the taxonomy doc has no such section and IDs
      are never deleted, only struck through in place with a dated pointer to
      what replaced them. Fix-now itself is unaffected (already a decoupled
      CTA, not the block).

## Spec Impact
- **Classification:** MODIFY + REMOVE
- **ADD:** none
- **MODIFY:** FR-01.30 (Triage tab & promote) — same FOLD reasoning as every
  prior triage iterate (outbox union, pending-delivery badge, deferred
  envelope, filters/sort): Edit-in-place extends the existing
  triage-management capability (Promote/Dismiss/Snooze + now Amend); it is
  not a new capability at the altitude test — a product owner would describe
  it as "you can now fix a typo on a triage card", not a new noun.
- **REMOVE:** the `LaunchPayloadBlock` informational rendering ACs under
  FR-01.30 (iterate-2026-05-20-triage-launch-surface-webui's two `(E)`
  bullets) — operator decision 2026-08-08: the raw pasted-command display is
  never used, only Fix-now is. Struck through in place with a "Superseded
  2026-08-08" note (spec.md's established removal convention — see
  Classification note above), not silently deleted. Fix-now's own ACs (the
  CTA + intent-building behavior, iterate-2026-05-21) are untouched — they
  describe a separate, still-live code path.
- **NONE justification:** n/a (Classification is not solely `none`)

## Out of Scope
- The monorepo envelope-key half (widening `undeliveredDecisions` so a
  buffered-but-undelivered amend is visible) — stays on the monorepo board as
  P2.56 (trg-a7682989, low). Do NOT widen `undeliveredDecisions` here: an
  item carrying both a buffered status flip and a buffered amend would
  collapse to one signal under a set union.
- Bundling with P2.34 (trg-8e0b4dd5, monorepo cross-repo divergence) — marked
  SPLIT BEFORE BUILD, not startable; same reader, separate runs.
- `kind` as an *editable field in the write UI* — the reader (Step 1) still
  resolves `kind` amends for parity (Python's `apply_amend` overlays it), but
  the Edit form (Step 2) exposes only title/detail/severity per the filing
  card's explicit decision.

## Design Notes
No new visual pattern — the Edit form reuses the existing wizard-token dialog
treatment already established for Promote/Snooze (ADR-102). Placement:
a pencil icon-button in the modal header row (beside `Dialog.Title` / the
Close `X`), toggling the title/severity/detail block between read display
and an inline Save/Cancel form — kept separate from the existing
Fix-now/Dismiss/Snooze/Promote action row, which stays visually and
semantically a "status transition" row; Edit is a "correct the record"
affordance and reads wrong mixed into that row as a fifth button. Removing
`LaunchPayloadBlock` frees the vertical space the inline form needs without
growing the modal's overall height. Design Check Tier 1 (text) applies; no
mockup file changes expected.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `shared/scripts/triage.py amend_triage_item` (Python producers / CLI) | `server/src/core/triage-store.ts resolveUnion` / `readAllItems` (WebUI) | JSONL `amend` event |
| `server/src/core/triage-write.ts appendAmendEvent` (new, WebUI write) | Same WebUI reader + any Python consumer (e.g. `triage_cli.py list`) | JSONL `amend` event |

## Confidence Calibration
- **Boundaries touched:**
  1. `shared/scripts/triage.py read_all_items` / `amend_triage_item` (Python
     producer/reader, pre-existing) ↔ `server/src/core/triage-store.ts
     readAllItems`/`resolveUnion` (WebUI reader, Step 1 — cross-language
     parity).
  2. `server/src/core/triage-write.ts appendAmendEvent` (new WebUI write) →
     the same reader + any Python consumer (`triage_cli.py list`) — a new
     JSONL producer onto an existing multi-consumer format.
  3. `TanStack Query cache (useTriage.ts itemsKey)` → `TriageDetailModal`
     (open-modal display) — a new mutation (`useAmendTriageItem`) writing
     into a cache an already-mounted component reads.
- **Empirical probes run:**
  1. Cross-language round-trip: TS `readAllItems()` vs. the real Python
     `triage.read_all_items()` on regenerated fixtures covering
     accumulation (two amends) and true `(ts, file-order)` interleaving
     with a status flip — **no finding** (Step 1, already green before
     this segment).
  2. Producer→file→consumer round-trip via the real HTTP route
     (`triage-routes-amend.test.ts`): POST body → `appendAmendEvent` →
     on-disk JSONL line → `readAllItems` → HTTP response — confirms the
     delta-only wire contract (absent fields never appear in the emitted
     line) — **no finding**.
  3. Control-character / non-ASCII round-trip through `JSON.stringify`
     (`triage-write-amend.test.ts`) — confirms title/detail containing
     newlines, quotes, and non-ASCII characters survive the write→read
     cycle unmangled — **no finding**.
  4. **Real-browser E2E round-trip** (`client/e2e/flows/triage-amend.spec.ts`
     against an isolated live server+client stack, not a mocked mutation
     hook): click pencil → edit title+severity → Save → assert the
     **already-open modal** reflects the correction. **Finding**: the modal
     still showed the pre-edit title — `TriageDetailModal` held `item` as a
     one-time prop snapshot from the parent's card click; nothing re-derived
     it from the TanStack cache after `useAmendTriageItem`'s `onSuccess`
     invalidation. Every earlier mutation (Promote/Dismiss/Snooze) closed
     the modal immediately on success, so this staleness path was never
     exercised before Edit (the first flow that keeps the modal open after
     a successful write). This is exactly the "are-you-confident anti-
     pattern" case: 26 passing unit tests (which all mock
     `useAmendTriageItem`) reported success; only the real-stack probe
     found the bug.
  5. Fix: added `useTriageDisplayItem(projectId, item)` (live-cache lookup,
     falling back to the prop) in `useTriage.ts`; wired
     `TriageDetailModal`'s header/detail/dl/action-row/`PromoteModal` reads
     through it. Re-ran probe 4 — **no finding** (both E2E tests green:
     Save reflects the correction in the open modal AND the closed-then-
     reopened list card; Cancel writes nothing).
- **Test Completeness Ledger:**

  | # | Behavior | Category | Disposition | Evidence |
  |---|---|---|---|---|
  | 1 | `readAllItems` overlays a single valid amend | unit | tested | `triage-store.test.ts` |
  | 2 | Two amends accumulate (later-ts-wins per field) | unit | tested | `triage-store.test.ts` |
  | 3 | Amend interleaved with a status flip resolves in true ts/file-order | unit | tested | `triage-store.test.ts` |
  | 4 | Invalid PRESENT field skips the whole amend (no partial apply) | unit | tested | `triage-amend.test.ts` |
  | 5 | `severity` amend recomputes `suggestedPriority`; `kind` amend leaves `suggestedDomain` untouched | unit | tested | `triage-store.test.ts` |
  | 6 | TS reader deep-equals Python reader on regenerated fixtures | parity | tested | `triage-store.test.ts` fixtures (regenerated via real `triage.py`) |
  | 7 | `appendAmendEvent` writes a delta-only line (absent fields omitted) | unit | tested | `triage-write-amend.test.ts` |
  | 8 | `appendAmendEvent` bootstraps a missing tracked file (mkdir + header) | unit | tested | `triage-write-amend.test.ts` |
  | 9 | `appendAmendEvent` control-char/non-ASCII round-trip | boundary | tested | `triage-write-amend.test.ts` |
  | 10 | Write target follows residence (tracked vs. outbox), matching status-flip precedent | unit | tested | `triage-write-amend.test.ts` |
  | 11 | `parseAmendBody` rejects a contentless body / invalid severity / non-object / bad id | unit | tested | `triage-validation.test.ts` |
  | 12 | `POST /amend` 200/400/404/409/503 route contract | route | tested | `triage-routes-amend.test.ts` |
  | 13 | `writesRouteToOutbox` computed correctly on idle main / feature branch / no-remote | unit | tested | `triage-board-read.test.ts` |
  | 14 | Pencil Edit toggle: visible only for `status==="triage"` and not already editing | unit | tested | `TriageDetailHeader.test.tsx` |
  | 15 | Provenance subtitle shown iff `amendedBy` set | unit | tested | `TriageDetailHeader.test.tsx` |
  | 16 | `TriageAmendForm` builds a correct delta (Cancel = no-op, Save = changed fields only) | unit | tested | `TriageAmendForm.test.tsx` |
  | 17 | AC9 disclosure banner: shown on `false`/`undefined`, hidden on `true` | unit | tested | `TriageAmendForm.test.tsx` |
  | 18 | Modal wiring: Edit swaps Detail for the form, hides the action row + pencil | unit | tested | `TriageDetailModal.amend.test.tsx` |
  | 19 | **Open modal reflects a successful Save without a manual close/reopen** | integration | tested | `client/e2e/flows/triage-amend.spec.ts` (real stack — the probe-4 finding) |
  | 20 | Cancel writes no `amend` event; original title/detail/severity survive on disk | integration | tested | `client/e2e/flows/triage-amend.spec.ts` |
  | 21 | `LaunchPayloadBlock` removal leaves no dangling import/fixture reference | unit | tested | full client suite green post-deletion (no orphaned import) |
  | 22 | env-file-style boundary categories (POSIX `export` prefix, inline `#` comment, hash-in-value, quoted `#`) | boundary | untestable | `covered-by-existing-test` — not applicable: the wire format is a JSON-serialized JSONL line (`JSON.stringify`/`JSON.parse`), not env-file syntax; those 4 `boundary-probes.md` categories are specific to `KEY=value` parsing. UTF-8/CRLF/non-ASCII/empty-value are covered instead by ledger rows 9 and 11 (native `JSON.stringify` handles encoding; contentless-body rejection covers the empty-value case). |
  | 23 | `writesRouteToOutbox` reflects a branch switch on the very next read — no TTL-cache staleness window | unit | tested | `triage-board-read.test.ts` (rewritten after the async-git-probe fix, external code-review finding) |
  | 24 | `buildDelta` diffs against a mount-time snapshot (`initialItem`), not the live polled `item` prop | unit | tested | `TriageAmendForm.test.tsx` (doubt-review regression test) |
  | 25 | `buildDelta`'s title change-detection compares raw local state to the raw stored title (no whitespace false-positive) | unit | tested | `TriageAmendForm.test.tsx` (external code-review regression test) |
  | 26 | `TriageDetailHeader` hides the read-mode title text and severity badge while `editMode` is true (no dual read/edit display) | unit | tested | `TriageDetailHeader.test.tsx` (external code-review regression test) |
  | 27 | `TriageAmendForm.onSave` surfaces a rejected mutation (network failure) as an inline error, not an unhandled rejection | unit | tested | `TriageAmendForm.test.tsx` (external code-review regression test) |

  0 testable-but-untested behaviors.
- **Confidence-pattern check:**
  - **Asymptote (depth):** probe 4 found a real bug after 3 prior "green"
    signals (unit tests × 3 test files, typecheck, lint); probe 5 (re-run
    after the fix) found nothing — asymptote reached per the decision rule
    (last probe clean, all applicable `boundary-probes.md` categories
    resolved with justification, single consumer so no cross-consumer
    drift-protection test needed, and the "confident → bug" cycle happened
    exactly once and was answered with one more probe, not zero).
  - **Coverage (breadth):** Test Completeness Ledger above — 22 rows, 0
    testable-but-untested, 1 `untestable` row with a closed-vocabulary
    reason. `touches_io_boundary` did not fire in `classify_complexity.py`
    output (the diff's only new serialized format is JSON, already native
    to both producer and consumer languages), so the Boundary Probe
    sub-step's mandatory-8-categories gate does not apply structurally;
    ledger row 22 documents that reasoning inline rather than silently
    skipping the doc.

## Review Findings Disposition

Every review-cascade finding, each marked `accepted-and-fixed` or
`rejected-with-reason` before commit (`iteration-reviews.md`'s disposition
rule):

| Stage | Finding | Disposition |
|---|---|---|
| code-reviewer | Unbounded, event-loop-blocking `spawnSync` git probe (up to 3 calls) on every `GET /api/triage/:projectId`, polled every 30s per project | accepted-and-fixed — 5s TTL cache local to the read path |
| code-reviewer | `shipwright_bloat_baseline.json` `current` counts for `triage-store.ts`/`triage.ts` were stale/inflated | accepted-and-fixed — resynced to measured counts |
| code-reviewer | `triage-store.union.test.ts` had cross-file coverage for `status` but not `amend` | accepted-and-fixed — added the cross-file amend test |
| doubt-reviewer | `buildDelta` diffed local form state against the LIVE (polling) `item` prop, silently reverting a field an operator never touched if it changed underneath the open form | accepted-and-fixed — `initialItem` mount-time snapshot |
| external-review (round 1) | The code-reviewer's TTL cache could serve a stale `true` for up to 5s after a branch switch, suppressing AC9's disclosure banner exactly when it exists to fire (AC9 fail-toward-disclosure violation) | accepted-and-fixed — replaced the cache with an uncached, async (`execFile`) git probe local to `triage-board-read.ts`; no staleness window, no event-loop blocking |
| external-review (round 1) | `TriageDetailHeader` always shows the read-mode title + severity badge, even while `TriageAmendForm` shows editable equivalents for the same two fields (mixed read/edit dual-display) | accepted-and-fixed — hide title text (`sr-only`, `Dialog.Title` still renders for a11y) + `SeverityBadge` while `editMode` |
| external-review (round 1) | `buildDelta`'s title change-detection compared a `.trim()`'d local value against the un-trimmed stored title — a stored title with incidental whitespace would false-positive "changed" | accepted-and-fixed — raw-vs-raw comparison (`title !== item.title`), trim only the value sent |
| external-review (round 2) | `TriageAmendForm.onSave` called `amend.mutateAsync` with no try/catch — a rejected fetch (network failure) became an unhandled rejection, leaving the form open with no feedback | accepted-and-fixed — try/catch mirroring `TriageDetailModal.onStartCampaign`'s existing pattern for the identical failure mode |
| external-review (round 3, deepseek) | `applyAmend` collapses a non-string `by`/`ts` to `null`, which can erase `amendedBy`/`amendedAt` provenance from an earlier valid amend when a later amend has valid content fields but a malformed `by`/`ts` | **rejected-with-reason** — this is not a WebUI-introduced defect. `triage-amend.ts` is an explicit line-for-line TS port of the canonical `shared/scripts/lib/triage_amend.py apply_amend` (see that file's own header comment), and the Python source already does the exact same collapse-to-`None`, with its own comment citing this as a deliberate decision from that codebase's Stage-3 doubt review (finding 7): "keeps these two fields `str \| None` for every consumer". Changing the TS side to skip the whole event instead would *diverge* from the Python behavior — breaking cross-language parity, this iterate's own Boundary #1 (Confidence Calibration above) — not converge with it. openai's independent pass on the same diff returned `approve` with no findings. |

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright E2E against the built stack, new
  `client/e2e/flows/triage-amend.spec.ts` (pattern:
  `triage-filters-sort-parked.spec.ts`)
- **Evidence path:** `shipwright_test_results.json` →
  `iterate_latest.surface_verification`
- **Justification (only if surface=none):** n/a
