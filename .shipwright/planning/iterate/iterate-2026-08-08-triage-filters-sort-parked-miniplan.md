# Mini-Plan: triage-filters-sort-parked

- **Run ID:** iterate-2026-08-08-triage-filters-sort-parked

## 1. Files to create/modify

Revised after internal Opus plan review (2026-08-08) — see §7 for what
changed and why. Three structural extractions added specifically to
keep `PerProjectTriageSection.tsx` / `TriagePage.tsx` under the ~300-LOC
bloat ceiling given the corrected (larger) selector contracts.

**New:**
- `client/src/lib/triageFilterSort.ts` — pure filter/sort logic:
  `getComplexity()` (forward-compat shim), `matchesAttributeFilters()`
  (Priority/Domain/Complexity only), `selectVisibleOpenItems(items,
  filters): { visible, hiddenCount }` (AC8 bypass, excluded from
  `hiddenCount`), `selectVisibleDeferredItems(items, filters,
  showParked): { visible, hiddenCount }` (AC9 bypass, dateless items
  still filtered on attributes, `hiddenCount` sums both suppression
  causes per AC7), `sortItems()` (two-level comparator, pinned
  `localeCompare` options, trailing `id` tiebreaker mirroring
  `sortDeferred`'s total-order pattern). `hiddenCount` in both selectors
  is always structurally `input.length - visible.length` — never a
  second predicate pass, so it cannot drift from what's actually shown.
- `client/src/lib/triageFilterSort.test.ts` — unit tests including: both
  exception paths in isolation AND at their intersection (mixed
  dateless-visible + dated-hidden Deferred set; due-parked item under an
  excluding filter is present, marked-eligible, and NOT in
  `hiddenCount`); the Modified-uses-`ts`-not-`originalTs` guard; sort
  output invariant under input permutation; an unrecognized wire key
  (simulating a future `suggestedComplexity`) survives a `resolveUnion`-
  shaped passthrough fixture.
- `client/src/hooks/useTriageViewState.ts` — owns the filter/sort state
  object, defaults, and updater callbacks (`useState` + a small reducer-
  ish API), extracted out of `TriagePage.tsx` specifically so that
  file's growth stays in one small, focused module instead of inline
  `useState` calls padding the page component.
- `client/src/components/triage/TriageFilterSortBar.tsx` — thin host
  component: renders `TriageFilterGroup` (Priority / Domain / Complexity
  / Parked) and `TriageSortLevel` (primary / secondary) children; owns
  no logic itself.
- `client/src/components/triage/TriageFilterGroup.tsx` — one filter
  control (a set of togglable value chips, or the Parked boolean toggle
  in the same shape); reused four times.
- `client/src/components/triage/TriageSortLevel.tsx` — one sort-level
  control (key dropdown + direction toggle); reused twice.
- `client/src/components/triage/TriageFilterSortBar.test.tsx` — component
  tests (renders all controls including the always-visible Complexity
  group per the operator's explicit decision, default state, change
  handlers fire with the right shape).
- `client/src/components/triage/PerProjectTriageSection.test.tsx` — did
  not exist before this iterate; added because the component's
  rendering logic changes materially. Covers: flat list ordering;
  hidden-count line; **a project whose items are ALL filtered out still
  renders its heading + hidden-count line, never `null`** (the
  corrected visibility gate); the `Visible (of Total)` count convention.

**Modified:**
- `client/src/pages/TriagePage.tsx` — mount `useTriageViewState()`, add
  `useQueries` over all registered projects' triage items with
  `refetchInterval: false` on this arm specifically (the section-owned
  `useTriageItems` observer on the same queryKey already drives the 30s
  poll; a second independently-scheduled interval on the same key was
  flagged in review as unverified and unnecessary — this data is only
  needed for the domain-option list and the aggregate hidden-count, both
  fine to lag slightly behind the section's own poll) to derive live
  Domain filter options and a page-level aggregate hidden-count, mount
  `<TriageFilterSortBar>`, pass `filters`/`sort` down to each
  `<PerProjectTriageSection>`. Add the all-filtered-out page state
  (distinct from the genuine-empty state, both keyed correctly per the
  Design Notes correction).
- `client/src/hooks/useTriage.ts` — export `triageItemsQueryOptions(projectId)` (factored out of the existing `triageListQuery` shape) so `useQueries` in `TriagePage.tsx` shares the exact queryKey/queryFn `useTriageItems` already uses — no drift between the two call sites, no duplicate fetch.
- `client/src/components/triage/PerProjectTriageSection.tsx` — replace `itemsBySource`/`sortedSources` grouping with a flat filtered+sorted list (via the new lib functions); add the "N hidden by filter" line; apply the same filters (plus the Parked toggle + its exception) to `deferredItems`; pass `hiddenCount` down to `DeferredTriageSection`. **Visibility gate corrected to key off unfiltered counts** (see Design Notes) — this was the first high-severity review finding.
- `client/src/components/triage/DeferredTriageSection.tsx` — accept a `hiddenCount` prop; render a hint line ("N parked items hidden by the current view") whenever `hiddenCount > 0`, **independent of `items.length`** (the mixed-set fix — second high-severity review finding); relax the early return to `if (items.length === 0 && hiddenCount === 0) return null`.
- `client/src/components/triage/DeferredTriageSection.test.tsx` — extend for the new hint-line behavior, including the mixed dateless+dated case.
- `client/src/components/triage/TriageItemCard.tsx` — add a small "Returned" badge when `item.revisitDue === true` (AC8's "visually marked" requirement — the item is already in the list by construction; the badge is what keeps it from blending in, and stays shown for as long as the bypass is active — see AC8's no-expiry note).
- `client/src/components/triage/TriageItemCard.test.tsx` — extend for the badge.
- `client/src/test/doc-sync.test.ts` `REQUIRED_TOKENS` (or the equivalent registry it reads) — add entries for the new components/modules; `.shipwright/agent_docs/component_inventory.md` + `architecture.md` — add matching entries, same commit (doc-sync meta-test enforces this bidirectionally).
- `.shipwright/planning/01-adopted/spec.md` — append the new FR-01.30 acceptance-criteria lines (done at F1, reflecting what's actually built).

## 2. Work breakdown

1. `triageFilterSort.ts` + its unit tests — pure logic first (TDD), no UI dependency, fastest feedback loop. Covers AC1–AC4, AC7–AC10 at the logic level.
2. `useTriage.ts` — factor out `triageItemsQueryOptions`; add a thin `useAllTriageItems(projectIds)` wrapper around `useQueries`. Unit test: queryKey parity with `useTriageItems`.
3. `TriageFilterSortBar.tsx` + component tests — UI shell wired to plain props/callbacks (no store access — a view component).
4. `TriageItemCard.tsx` — add the "Returned" badge (small, independent, unblocks AC8's visual-marking requirement early).
5. `DeferredTriageSection.tsx` — add `hiddenCount` prop + hint line; extend its existing test file.
6. `PerProjectTriageSection.tsx` — wire everything together: replace grouping with the flat sorted/filtered list, hidden-count line, deferred-section filtering + exception. New test file covers AC5, AC6, AC7, AC9 at the component level.
7. `TriagePage.tsx` — lift state, mount the filter bar, wire `useQueries` for domain options + aggregate hidden-count.
8. E2E: `client/e2e/flows/triage-filters-sort-parked.spec.ts` against the real dev stack — the AC-N-agent evidence for F0.5.
9. `spec.md` FR-01.30 AC lines (F1).

## 3. Component hierarchy

```
TriagePage (+ useTriageViewState)
├── TriageFilterSortBar                    (new — thin host)
│   ├── TriageFilterGroup ×4                (Priority/Domain/Complexity/Parked)
│   └── TriageSortLevel ×2                  (primary/secondary)
└── PerProjectTriageSection[]    (one per registered project)
    ├── TriageItemCard[]          (flat, filtered+sorted open items;
    │                              "Returned" badge when revisitDue)
    └── DeferredTriageSection
        └── (deferred item buttons, existing markup, + hint line)
```

## 4. Data model changes
None — no store/contract/migration changes (operator constraint).

## 5. Test strategy
- Unit: `triageFilterSort.test.ts` (pure logic, both exceptions AND their
  intersection, Modified-sort-source guard, sort-permutation invariance,
  unrecognized-wire-key passthrough), `useTriage` queryKey-parity test,
  component tests for `TriageFilterSortBar` (+ its two children),
  `PerProjectTriageSection` (incl. the all-filtered-out-still-renders
  case), `DeferredTriageSection` (incl. the mixed dateless+dated case),
  `TriageItemCard`.
- E2E (mandatory at medium+, author + execute): filter narrows the list
  and shows the hidden-count line; two-level sort reorders correctly; a
  due-parked fixture item survives an excluding filter, is marked
  "Returned", and is not counted as hidden; a dateless-parked fixture
  item survives the Parked-off default; a project whose items are all
  filtered out still shows its heading + hidden-count line; flat list
  has no source-derived heading. `triage-deferred-envelope.spec.ts`'s
  existing seed helpers (due / future-dated / undated park fixtures)
  are reused rather than rebuilt.
- No integration/pgTAP layer — no DB/CRUD/RLS touched.

## 7. Changes made after internal Opus plan review (2026-08-08)

The review (model=opus) found three high-severity defects where the two
named exceptions (AC8, AC9) were designed independently and broke at
their intersection, plus a direct conflict between one of its own
suggestions and an explicit operator decision. Folded into this plan and
the iterate spec:

1. **Visibility gate must key off unfiltered counts** — a project (or
   the whole page) with everything filtered out must still show its
   heading + hidden-count line, never silently render nothing. Was:
   gated on the filtered array length; now: gated on the raw item count,
   filtered/visible computed separately.
2. **Deferred hint must fire on `hiddenCount > 0` alone** — a mixed set
   (some parked items visible via the AC9 exception, others hidden by
   the Parked-off default) was previously invisible to the hint's
   `items.length === 0` condition.
3. **AC8's bypass is permanent by design, not a decaying grace period**
   — `revisitDue` is recomputed `true` on every read for as long as the
   item stays parked server-side; an item returned from a park stays
   un-filterable until the operator acts on it. Stated explicitly in
   AC8 so it reads as intentional, not as filter-erosion to be "fixed"
   later. Bypassed items are excluded from `hiddenCount` (they were
   shown, not hidden).
4. **Rejected the review's suggestion to hide the Complexity control**
   until real data exists — this directly contradicts the operator's
   explicit 2026-08-07 instruction that the control stay visible with
   `Unset` as a real, clickable value. Kept as originally specified.
5. Added the `useTriageViewState` / `TriageFilterGroup` /
   `TriageSortLevel` extractions to manage the bloat-ceiling risk the
   review flagged on `TriagePage.tsx` / `PerProjectTriageSection.tsx`
   given the now-larger selector contracts.
6. `sortItems()` gained a pinned `localeCompare` config and a trailing
   `id` tiebreaker (mirroring `sortDeferred`'s existing total-order
   pattern) so ordering is neither locale-dependent nor input-order-
   dependent.
7. Set `refetchInterval: false` on the page-level `useQueries` arm —
   the review flagged the "no extra network cost" claim as asserted,
   not verified; disabling this arm's own interval removes the question
   (the section-owned observer on the same queryKey already polls).
8. `hiddenCount` is now always `input.length - visible.length`,
   returned directly by the selector — never computed by a second,
   independently-written predicate pass that could drift from what's
   actually rendered.

## 6. Alternative approach (considered and rejected)

**Rejected: Domain filter as free-text search instead of a discrete
multi-select.** `suggestedDomain` is a free string (not a closed enum
like Priority), so a substring-search input would have been simpler to
build — no need for `useQueries` to aggregate live domain values across
projects, no risk of an option list that's stale or incomplete on first
paint.

**Why rejected:** the operator described Domain as "the axis the
operator actually thinks in" — language that implies a small, known
vocabulary (e.g. "engineering", "security") the operator recognizes and
picks from, not a string they'd need to recall and type correctly each
time. A discrete multi-select also matches the UX of the Priority and
Complexity filters sitting right next to it (pick-which-values-to-
include), where a text box would be a visibly different interaction
model for no clear benefit. The `useQueries` cost is low — it reuses the
exact queryKey each `PerProjectTriageSection` already fetches, so it is
a live subscription to already-cached data, not a new network cost.
