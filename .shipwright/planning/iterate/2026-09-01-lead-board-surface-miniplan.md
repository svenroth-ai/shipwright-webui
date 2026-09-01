# Mini-Plan: lead-board-surface

- **Run ID:** iterate-2026-09-01-lead-board-surface

## Chosen Approach

Three new files carry almost all new logic, so the two already-over-budget
files (`TaskCard.tsx` 476/300, `TaskBoardPage.tsx` 447/300) grow by wiring
only:

1. `client/src/lib/leadTags.ts` (+test) — the three tag-prefix constants and
   pure predicate/parse helpers (`isLeadOriginated`, `isWaitingOnPo`,
   `hasDedupTag`, `matchesAnyLeadPrefix`, `leadOriginId`, `dedupKey`,
   `hasAnyLeadTag`). No React, no server call — a plain string-matching
   module, trivially unit-testable in isolation.
2. `client/src/components/external/LeadTagFilter.tsx` (+test) — exports
   `LeadTagFilterMenu` (the Bot dropdown, `BoardStatusFilter`-shaped: Radix
   `DropdownMenu` + `CheckboxItem` per prefix + live counts + an "All" reset
   row) and `LeadWaitToggleButton` (the BellDot single toggle). Both take
   `{ counts, active, onToggle, onReset }`-shaped props exactly like
   `StatusFilterMenu`, so `TaskBoardPage` wires them the same way it already
   wires the status filter.
3. `client/src/components/external/TaskCardLeadExpander.tsx` (+test) —
   exports `LeadOriginGlyph` (the small Bot icon for the meta row) and
   `TaskCardLeadExpander` (the chevron toggle + panel showing domain /
   priority / complexityHint / the three lead tags in human-readable form).
   Renders `null` when the task carries none of those fields — mirrors
   `TaskDescriptionDisclosure`'s "render nothing when there's nothing to
   show" contract.

Then thin wiring:

4. `TaskCard.tsx` — import `LeadOriginGlyph` + `TaskCardLeadExpander`; render
   the glyph before `ProjectPill` in the meta row; render the expander toggle
   + panel as a new block (own `stopPropagation` on click, same technique the
   failure-notice block already uses at `:290`) so it never reaches
   `navigateToDetail`. Net new lines: ~10-15.
5. `TaskBoardPage.tsx` — add `leadTagFilter: Set<LeadTagPrefix>` state +
   `toggleLeadTag`/`clearLeadTagFilter` callbacks (byte-for-byte the same
   shape as the existing `statusFilter` block), fold it into the
   `filteredTasks` memo alongside `statusFilter`, compute `leadTagCounts`
   over `projectFiltered`, and render `<LeadTagFilterMenu>` +
   `<LeadWaitToggleButton>` next to `<StatusFilterMenu>` in the toolbar `left`
   slot. Net new lines: ~20-25.
6. Update `shipwright_bloat_baseline.json`'s `current` for both files to
   their new honest line counts in the same commit (see iterate spec Design
   Notes — sanctioned, not a bypass).
7. Author + run `client/e2e/flows/lead-board-surface.spec.ts` (Playwright,
   medium+ mandatory web-surface verification).

## Work Breakdown (TDD order)

1. `leadTags.ts` + `leadTags.test.ts` (red → green).
2. `LeadTagFilter.tsx` + `.test.tsx` (mirrors `BoardStatusFilter.test.tsx`
   structure — dropdown open/toggle/reset, plus the BellDot toggle).
3. `TaskCardLeadExpander.tsx` + `.test.tsx` (glyph presence/absence; expander
   open/close; renders-nothing-when-empty; click isolation from card nav).
4. Wire `TaskCard.tsx`; extend `TaskCard.test.tsx` with glyph + expander +
   "navigation still fires outside the expander" cases.
5. Wire `TaskBoardPage.tsx`; add/extend a page-level test if one exists,
   else cover the wiring transitively through the E2E spec (the page has no
   dedicated unit test today per the repo scout — confirm before skipping).
6. Update the bloat baseline; run `npm run lint && npm run typecheck && npm
   run test` in `client/`.
7. Author + execute the Playwright E2E spec against the dev stack.

## Alternative Approach (considered, rejected)

**Add the two lead-filter entries directly inside `BoardStatusFilter.tsx`'s
own dropdown**, per the earlier, looser prose reading of the source spec
("two entries in the existing menu"), instead of two new standalone toolbar
buttons.

Rejected because:
- It contradicts the task brief's explicit, literal instruction ("A Bot and
  BellDot button in the existing toolbar pattern") and the source spec's own
  binding AC-table row for this exact FR, which independently says the same
  thing ("Bot- und BellDot-Knopf im Werkzeugleisten-Muster").
  `BoardStatusFilter.tsx` is a **status** filter (`ExternalTaskState`); its
  own inline comment (`STATUS_FILTER_OPTIONS`) and its component name are
  both state-shaped, and folding a semantically unrelated tag-filter concept
  into it would make one component answer two different filtering questions
  — worse cohesion, not better.
- It would give `BellDot` no natural home at all (a *toggle*, not a
  checkbox row inside someone else's dropdown) and lose the visual
  discoverability the brief asks for (a notification-style bell for "waiting
  on me", separate from the general status funnel).
- W5d (claim chip, V3a) is coming next and already expected to touch
  `TaskCard.tsx`; keeping the toolbar filter logic in its own new component
  rather than growing `BoardStatusFilter.tsx` further keeps that file's
  scope narrow for whoever touches it next, same reasoning as trap #4 for
  `TaskCard.tsx` itself.

## External Plan Review

Per SKILL.md Step 4 (medium auto), this mini-plan + the iterate spec's
`## Architecture Review` payload go to `external_review.py --mode iterate`
and a second `--mode architecture` call before Build starts.
