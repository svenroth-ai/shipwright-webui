# Mini-Plan: triage-page-redesign (PR 1, client only)

- **Run ID:** iterate-2026-11-08-triage-page-redesign
- **Spec:** `2026-11-08-triage-page-redesign.md`; design: `.shipwright/designs/triage-redesign-proposal.html`

## Files (new / edit)
| File | Change |
|---|---|
| `client/src/lib/triageFilterSort.ts` | edit: include-set filters (empty = all), sort keys severity/priority/modified/name, `groupItems`; keep returned-park and dateless-park bypasses |
| `client/src/lib/triageViewStorage.ts` | new: versioned load/save/validate of the saved view (key `shipwright:triage-view:v1`), every access in try/catch |
| `client/src/hooks/useTriageViewState.ts` | edit: hydrate from storage, persist on change, add groupBy + collapsed + direction setters |
| `client/src/lib/triageFindings.ts` | new: parse bundle `detail` into check lines (code, text) |
| `client/src/lib/triageHelpText.ts` | new: English help texts (sources, severities, check codes) = approved proposal drafts |
| `client/src/components/triage/TriageHelp.tsx` | new: "?" popover (tap/keyboard/Esc) |
| `client/src/components/triage/TriageToolbar.tsx` (+ `TriageFilterMenu`, `TriageGroupMenu`, `TriageSortMenu`) | new: PageHead controls (ProjectFilterDropdown + funnel + Group + Sort), board style |
| `client/src/components/triage/TriageActiveFilters.tsx`, `TriageTiles.tsx` | new: chips row, summary tiles |
| `client/src/components/triage/TriageGroupList.tsx` | new: grouped, collapsible list over the aggregated items (replaces per-project sections) |
| `client/src/components/triage/TriageItemCard.tsx` | edit: new card (check lines, primary action, Promote, Snooze menu, Dismiss, quick edit) |
| `client/src/components/triage/TriageSnoozeMenu.tsx`, `TriageQuickEdit.tsx` | new: snooze menu (incl. pick a date), title+severity edit via existing amend hook |
| `client/src/components/triage/TriageDetailModal.tsx` | edit: Snooze menu + reuse quick edit; extract actions row to stay under 300 lines |
| `client/src/pages/TriagePage.tsx` | edit: compose toolbar/tiles/list; under 300 lines |
| removed: `TriageFilterSortBar`, `TriageFilterGroup`, `TriageSortLevel`, `PerProjectTriageSection`, `DeferredTriageSection` | replaced; tests ported, not loosened |

No server change. No new dependency. `ProjectFilterDropdown`/`useProjectFilter` reused unchanged.

## Work breakdown (sequential, tests first per step)
1. **View model** (pure): include filters, sort keys + per-level direction, grouping, findings parser, storage validate. Unit tests incl. corrupt/old-version/unknown-value payloads and round trip.
2. **State hook**: hydrate + persist; test reload simulation and failure of storage.
3. **Help texts + component**: test "every known code/source/severity has a text" against the real code catalog.
4. **Toolbar, chips, tiles**: board-parity markup; testids kept where they still exist.
5. **Group list + card**: new card, snooze menu, quick edit, parked section ("Show parked" in the funnel menu).
6. **Modal**: snooze menu, quick edit, file under 300 lines.
7. **Page assembly**, port old tests, class-fence tests (solid card, scroll ownership), E2E in a real browser (reload persistence, phone width, keyboard, snooze, edit).

## Component hierarchy
`TriagePage` → `PageHead`(actions: `TriageToolbar`) → body: `TriageTiles`, `TriageActiveFilters`, `TriageGroupList` → `TriageItemCard` → (`TriageHelp`, `TriageSnoozeMenu`, `TriageQuickEdit`); `TriageDetailModal` shares the same pieces.

## Test strategy
Vitest for pure logic and components; schema-sync tests untouched (no server change); class-fence tests for card surface and scroll ownership; Playwright E2E via the isolated-stack harness (medium+: author AND run).

## Alternative considered
Keep per-project sections and add controls on top. Rejected: grouping by severity/source/priority across projects needs one aggregated list, and keeping both models doubles the code paths.

## Risks
- Flipping filter semantics breaks many old tests: they are rewritten to the new rule, not deleted.
- `TriageDetailModal` is over 300 lines: extraction is part of step 6.

## Review integration (binding decisions after internal + external plan review)
1. **Polling.** `useAllTriageItems` becomes the polling owner (reuse the list query's refetch interval incl. the fast retry while write availability is `checking`); the "false" override and its comment/test are replaced. Test: page refetches on the interval.
2. **Per-project strip.** One status strip above the list: a drift banner per project with commits behind, a load indicator, and an error row with Retry per failed project. Existing testids and tests are ported, not dropped (guard from the earlier failed-project finding).
3. **Project identity.** The aggregate is a list of `{projectId, item}`; React keys are `projectId:itemId`; selection, mutations, amend, Fix now (project preselect) and "Go to board" all use the entry's projectId. Tests: same triage id in two projects; Fix now from a card in a mixed list preselects its own project.
4. **Filter vs. parked.** Only the attribute predicate changes (empty set = all). The returned-park and dateless-park bypass lines stay in their separate selectors unchanged. Table tests: returned park + non-matching include set; dateless park + Parked off; dated not-due park + Parked off; dated park + Parked on + include set. "Showing N of M": M = open items + parked items visible by default, documented in code.
5. **Parked items.** Keep a separate "Parked" section ordered as today (by return date), read-only except "Return now" and Dismiss; the "N parked hidden" hint and both empty states (genuinely empty vs. all filtered out) with their testids stay.
6. **Saved view.** Lazy initial state (never write before first read), arrays for sets, per-field validation with fallback (unknown sort/group key, unknown direction, legacy `excluded*` shape), ticked values that no longer exist are NOT pruned (amended during build: data loads asynchronously and a value can be absent only in the current project scope, so pruning on load would silently drop a valid choice) — they stay as removable chips with a 0 count so an invisible filter can never explain an empty list, `collapsed` stored with its groupBy and reset on a groupBy change. Search is transient and not saved. No cross-tab sync (accepted limitation).
7. **Project dropdown.** Reuse `ProjectFilterDropdown`/`useProjectFilter` (persisted, shared with the Board); a saved id that is no longer a real project is treated as "All projects".
8. **Search.** A small `TriageSearch` (title and detail), shown only above 12 open items; transient.
9. **Quick edit.** Reuses the existing amend hook and delta builder; gated by the project's write availability (same message as today); after a save the card and modal show the server's resolved severity and priority.
10. **Snooze presets.** Local calendar-date arithmetic (month-end and DST tested), serialized exactly as the existing revisit field does; past dates rejected in the picker; "Pick a date" opens a small popover, not an input inside a menu item; reason is optional.
11. **Findings parser.** Fixtures from real compliance and phase-quality bundles; any unparsable detail renders as plain text, never dropped; unknown codes get a generic fallback help text.
12. **Help catalog.** The coverage test checks every code that appears in the repo's real triage fixtures plus the known catalog list; unknown codes fall back gracefully.
13. **Housekeeping.** Radix `DropdownMenu`/`Popover` for menus and help (no hand-rolled), `ModalScrollBody` untouched, tokens only, rule 27 single scroller, `DensityToggle` stays in the header, performance: stable aggregate via query combine, memoised pipeline, `React.memo` cards, lazy menu content. Deleting components also updates the bloat baseline and the component inventory docs in the same PR; per-file line budget checked at step 7. Phone-width toolbar E2E added.
14. **Scope reductions (external architecture review, option B argument).** Kept as approved by the operator: aggregated list and grouping were requested explicitly. Dropped: nothing else. Persisted collapse stays because the fallback path covers stale keys at no extra cost.
