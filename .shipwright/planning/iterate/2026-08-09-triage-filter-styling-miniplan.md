---
run_id: iterate-2026-08-09-triage-filter-styling
---

# Mini-Plan

## Files to modify

- `client/src/components/triage/TriageFilterGroup.tsx` — edit: chip radius,
  border weight, on/off encoding (see Step 3 — this supersedes an earlier
  draft of this file that used a primary-tinted "active" state; internal +
  external plan review both flagged that as a regression, folded into AC2).
- `client/src/components/triage/TriageSortLevel.tsx` — edit: matching
  radius/border on the `<select>` and the direction-toggle button, for
  visual consistency within the same bar.
- `client/src/components/external/PreviewButton.tsx` — edit: background
  token.
- `client/src/components/external/CreateControls.tsx` — edit: gate
  `<PreviewButton>` on `resolvedProjectId === activeProjectId` (corrected
  at code review Stage 2 from the originally-planned `activeProjectId ===
  null` — that alone misses the synthesized "Unassigned" pseudo-project,
  which shares the All-Projects `realProjects[0]` fallback).
- `client/src/components/triage/TriageFilterGroup.test.tsx` — edit: assert
  new class shape (radius/border geometry + the included/excluded
  encoding, not an "active" state).
- `client/src/components/triage/TriageSortLevel.test.tsx` — edit: assert
  the same radius/border geometry as the chips, for the same reason Step 4
  restyles it (one bar, one geometry).
- `client/src/components/external/CreateControls.test.tsx` — edit: add the
  All-Projects-hides-Preview case AND the single-project-still-shows-it
  case, both with `previewEnabled` explicitly `true` (a case that defaults
  it `false` would pass vacuously regardless of whether the gate exists).
- `client/src/components/external/PreviewButton.test.tsx` — edit: assert
  the new `bg-[var(--color-info-bg)]` class, not the old
  `bg-[var(--color-surface)]`.
- `client/e2e/flows/triage-filter-preview-restyle.spec.ts` — new: real
  browser E2E asserting `getComputedStyle` (border-radius, background
  colors, conditional presence) — a medium iterate's ACs need more than a
  jsdom class-string match (internal plan review finding 2).
- `CLAUDE.md` — edit: "Preview-capability precedence" gets a 4th gate
  (project scope) documented alongside the existing three.
- `.shipwright/agent_docs/conventions.md` — edit: convention 7's
  Preview-precedence one-liner gets the same 4th-gate clause, kept in sync
  with CLAUDE.md (code review Stage 3).
- `client/src/styles/tokens.contrast.test.ts` — edit: new ladder rung for
  `--ink-fixed on --inset`, the excluded chip's actual token pair — makes
  that choice machine-checked, not just asserted in a unit test (code
  review Stage 3, after the ladder's own pre-existing `--body on --inset`
  rung proved `--color-muted` fails on this ground).

## Work breakdown

1. `PreviewButton.tsx` — swap `bg-[var(--color-surface)]` for
   `bg-[var(--color-info-bg)]`. Test: existing render test + new assertion
   on the class list + E2E `backgroundColor` check on the real dark bar.
2. `CreateControls.tsx` — move `<PreviewButton>` inside the
   single-project branch, gated on `resolvedProjectId === activeProjectId`
   (corrected at code review Stage 2 — `activeProjectId !== null` alone
   misses the synthesized "Unassigned" pseudo-project, which shares the
   All-Projects `realProjects[0]` fallback) — same relative position
   within that branch as before (still the first child, ahead of
   `PlainClaudeButton`/`CreateMenuSplitButton`; only removed from its old
   *unconditional* position above the branch). Test: three cases in
   `CreateControls.test.tsx` (single-project shown / All-Projects hidden /
   Unassigned hidden, all `previewEnabled=true`) + E2E toggling between
   All-Projects and single-project mode on the same page.
3. `TriageFilterGroup.tsx` — restyle chip classes to
   `rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)]`
   on every chip regardless of state. Encoding (AC2, the version that
   survived three review passes): **included** (default-on, the majority
   state) stays plain ink text, no fill, no color; **excluded** (the
   minority, an explicit user action) gets `bg-[var(--color-inset)]
   text-[var(--ink-fixed)] line-through` — `line-through` is the
   genuinely non-color cue (code review Stage 2 measured the inset fill
   alone at ~1.09:1 contrast, imperceptible); `--ink-fixed`, not
   `--color-muted` (code review Stage 3: the app's own machine-checked
   contrast ladder already records `--muted` on `--inset` as FAILING
   ~4.39:1 — `--ink-fixed` is the established fix for a control with its
   own fixed near-white ground, per `lib/phaseStyle.ts`); never
   `--color-faint` either (that token is contrast-ladder-reroled to
   decor-only, not legible body text).
   `--color-primary` appears **only** on the hover-affordance BORDER, on
   both states — no resting or hover state uses it as a text color, so a
   teal border unambiguously means "clickable", never "this is the current
   value" (and matches `StatusFilterMenu`'s own hover treatment, corrected
   at Stage 2 after the first draft inverted it). Test: update
   `TriageFilterGroup.test.tsx` class assertions (included has no primary
   color at rest or hover, excluded has the inset fill + line-through, both
   hover border-only to primary) + E2E computed `background-color` and
   `text-decoration-line` on an included vs. the always-excluded Parked
   chip.
4. `TriageSortLevel.tsx` — same radius/border bump on the `<select>` and
   the direction button for internal consistency (not separately requested
   by Sven, but leaving it at the old 4px/1px next to the just-restyled
   chips would look like two different bars glued together). Test:
   `TriageSortLevel.test.tsx` class assertions.
5. `CLAUDE.md` — document the Preview 4th gate (project scope) next to
   the existing three-source precedence description.
6. Visual verification pass: isolated dev stack, Playwright screenshot
   `/triage` and `/` (both project-scoped and All-projects), compare
   against Sven's reference screenshots; real-browser E2E spec (step-3/-
   above) for the ACs a screenshot can't assert mechanically.

## Component hierarchy (unchanged — styling only)

```
TriagePage
 └─ TriageFilterSortBar
     ├─ TriageFilterGroup ×4  (Priority / Domain / Complexity / Parked)
     └─ TriageSortLevel ×2

TaskBoardPage
 └─ CreateControls
     ├─ PreviewButton (now: only when a single project is active)
     └─ ...
```

## Data model changes

None.

## Test strategy

- Unit: `TriageFilterGroup.test.tsx`, `TriageSortLevel.test.tsx`,
  `PreviewButton.test.tsx`, `CreateControls.test.tsx`.
- **New E2E spec** (`client/e2e/flows/triage-filter-preview-restyle.spec.ts`,
  run against the isolated worktree dev stack): a jsdom class-string match
  proves the class landed, not that it paints as intended, and this is
  precisely a layout/color change on a `medium` iterate — real-browser
  `getComputedStyle` assertions are the actual verification, not an
  optional extra.
- Manual screenshot comparison against Sven's two reference images
  (`requires-manual-visual-judgment` for the final "does it read as
  standard" call — not agent-verifiable, that's what AC1-user/AC2-user are
  for) plus the `/triage` visual-regression baseline, which this change
  WILL move — regenerated at F11 (Linux-only pinned container, cannot run
  locally; see the iterate spec's Verification section).

## Alternative approach (rejected)

Rebuild the Triage filter bar as a Board-style funnel-icon dropdown
(`StatusFilterMenu` pattern) instead of restyling the always-visible chip
row. Rejected: that always-visible layout was a deliberate, very recent
design decision (iterate-2026-08-08-triage-filters-sort-parked, explicitly
chosen so Priority/Domain/Complexity/Parked are all scannable at a glance
without opening a menu). Sven's ask was specifically about *styling*
("das Styling ... so wie auf dem Board"), not about hiding the filters
behind a click — collapsing it into a dropdown would silently remove a
recently-and-deliberately-built affordance nobody asked to lose.
