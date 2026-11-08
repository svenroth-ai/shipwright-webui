# Triage page: one aggregated list, include-set filters, saved view

Run: `iterate-2026-11-08-triage-page-redesign` (FR-01.30, Spec Impact MODIFY). Spec: `.shipwright/planning/iterate/2026-11-08-triage-page-redesign.md`.

## Context

The Triage page rendered one section per project, filtered by an exclude-set (chips start "on", click to exclude), sorted by Domain/Name/Modified, lost its whole view on reload, looked unlike the Board, and showed compliance/security jargon without explanation. The operator approved an HTML mockup (`.shipwright/designs/triage-redesign-proposal.html`) as the design brief.

## Decisions

1. **One aggregated list of `{projectId, item}` entries.** Triage ids are not unique across projects (the same id can exist in two repos), so every React key is `projectId:itemId` and every action (Fix now, Promote, Snooze, Dismiss, amend, Start campaign) is bound to the *entry's own* project — never to the page's project dropdown. The project dropdown is the Board's `ProjectFilterDropdown` (shared with the Board); an unknown saved project falls back to "All projects".
2. **Include-set filters (empty set = all).** Severity / Source / Priority / Domain / Complexity behave like the Board: nothing ticked shows everything, ticked values narrow. Filters are NOT coupled to the Board. Two bypasses stay in separate selectors, as before: a returned park (`revisitDue`) bypasses every filter; a dateless park stays visible when "Show parked" is off but is still subject to attribute filters.
3. **Pipeline is one pure function** (`lib/triageBoardModel.ts`): scope → filter → search → tile → sort → group. "Showing N of M": N = open entries after filters/search/tile, M = open entries in the project scope; parked entries have their own section and count.
4. **Saved view** in `localStorage` key `shipwright:triage-view:v1`: versioned, validated per field, sets stored as arrays, unknown values dropped, every access in try/catch, lazily initialised. Collapsed groups are stored with their `groupBy` and reset when it changes. Search and the tile selection are transient. Only the project choice is shared with the Board.
5. **Polling owner moves.** The per-project sections that drove the 30 s poll are gone, so `useAllTriageItems` (a `useQueries` with a stable `combine`) now owns polling; it shares the query key/queryFn with `useTriageItems`/`useTriageDrift`, so no duplicate fetches.
6. **Card actions + quick edit.** The card carries the primary action, Promote, a Snooze menu (tomorrow / 1 week / 1 month / date / no date — presets floored at UTC tomorrow because the server validates "strictly in the future" on its own day) and Dismiss. Quick edit changes **title and severity only**; priority follows severity (server-derived), domain/complexity are read-only. All menus are portaled Radix popovers so they can never be clipped by the card or the dialog.
7. **Help text** is a static English catalog (`lib/triageHelpText.ts`) with a coverage test that scans the real `.shipwright/triage.jsonl` for every check code and a generic fallback for unknown codes.

## Consequences

- Removed: `PerProjectTriageSection`, `DeferredTriageSection`, `TriageFilterSortBar`, `TriageFilterGroup`, `TriageSortLevel`, `SnoozeRevisitField` and two obsolete Playwright specs. `TriageDetailModal.tsx` (281) and `TriagePage.tsx` (261) are back under the 300-line cap; both are now below the cap, but their grandfathered bloat-baseline entries are left in place (editing that file is a sensitive path; retiring them is a separate follow-up).
- Parked cards are **read-only**: the mockup's "Return now" was not built because the server has no un-snooze endpoint. Adding one is a server change and a follow-up.
- Stale ticked filter values (no longer present in the data) are shown as removable chips instead of being silently pruned, so an invisible filter can never explain an empty list.
- Follow-up (PR 2, not in this run): Fix-now remembers its task and the card/tile show "In progress" (additive server field).

## Rejected

- Keeping the per-project sections and bolting grouping on: duplicated polling/filter state per section and could not express "group by severity/source".
- Coupling the Triage filters to the Board's: the two pages filter different things; only the project is a shared concept.
- Persisting search text or the active tile: transient intent, surprising after a reload.
- Free-text amend of domain/priority/complexity: needs an amend-schema extension in the shared tooling (follow-up).
