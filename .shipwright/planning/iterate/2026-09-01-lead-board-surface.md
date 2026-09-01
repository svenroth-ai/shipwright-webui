# Iterate Spec: lead-board-surface

- **Run ID:** iterate-2026-09-01-lead-board-surface
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented

## Goal
Surface already-persisted lead-work metadata (`tags`, `domain`, `priority`,
`complexityHint`) on the Task Board so a PO can find and recognize lead-agent
work without a new page: two toolbar filter controls (Bot, BellDot) keyed off
the three closed-vocabulary tag prefixes (`lead:`, `lead-wait:`, `lead-dedup:`
— FR-04.10 in `leadwright/spec/lead-model-spec.md`), an in-place expander on
`TaskCard` showing the fields the card doesn't render today, and a small bot
glyph next to the project pill identifying lead-originated cards at a glance.

This is Track B, §9 step 4, of the leadwright/webui parallel work (SEQUENCING
brief V3, parallel with W5a/V2 and W5c/V4c). It runs autonomously; the task
brief itself resolves the one open design question (below) so no PO check-in
is needed mid-flight.

## Acceptance Criteria
- [x] (a) A Bot button and a BellDot button exist in the Task Board's existing
      toolbar row (next to `StatusFilterMenu`/`DensityToggle`), and each of
      the three tag prefixes (`lead:`, `lead-wait:`, `lead-dedup:`) is
      filterable and asserted by its literal string name in a test.
- [x] (b) An expander on `TaskCard` opens/closes in place without navigating,
      via mouse **and** keyboard (Enter/Space on the toggle); the
      pre-existing whole-card-click-navigates-to-detail behavior
      (`navigateToDetail`, `TaskCard.tsx:150,157`) still fires for
      interaction outside the expander control, and neither mouse nor
      keyboard interaction with the expander initiates a card drag (the
      card is draggable — `TaskBoardColumns.tsx`'s `DraggableCard` spreads
      `useDraggable`'s listeners, including a `KeyboardSensor`, on an outer
      wrapper `TaskCard` doesn't control). All three are proven by test —
      one silently breaking another is the risk this AC exists to catch.
- [x] (c) A bot glyph renders next to the `ProjectPill` for a task carrying
      any `lead:`-prefixed tag, and does not render for a task with no such
      tag.
- [x] (d) No fourth tag prefix is introduced; no new field is added to
      `ExternalTask` — `domain`, `priority`, `complexityHint`, `tags` are
      already persisted (iterate-2026-05-14-lead-foundation-task-schema) and
      this card only reads them.
- [x] (e) `npm run test`, `npm run typecheck`, `npm run lint` are green in
      both `client/` and `server/` (server is untouched by this change but
      must stay green).

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.01 (Task board) — this is a FOLD: the board already
  displays state/phase/project-pill and (on the separate `MasterTaskCard`)
  priority/domain/blockedBy; this iterate extends the same "surface
  already-persisted metadata" capability to the per-task `TaskCard` plus adds
  board-level filtering by the lead tag vocabulary. Not a new capability —
  the fields and the tag vocabulary both already exist server-side.
- **REMOVE:** none
- **NONE justification:** n/a (classification is modify)

## Out of Scope
- The Inbox card surface (W5a / V2) — separate iterate.
- The org-page conversation thread (W5c / V4c) — separate iterate.
- The claim chip and its filter (W5d / V3a) — explicitly deferred; W5d touches
  `TaskCard.tsx` after this card lands and must not have to redo this work.
- Rebuilding server-side tag filtering — `GET /api/external/tasks?tag=`
  already exists (exact-match, single-value, V1/webui#371) for other
  consumers (e2e, the leadwright dedup search); this card filters the
  already-loaded client-side task list, exactly like the existing
  `statusFilter`/`filteredTasks` mechanism in `TaskBoardPage.tsx`.
- Any new persisted field. `blockedBy` display (shown today only on
  `MasterTaskCard`) is not added to `TaskCard`'s expander — not requested by
  this brief's acceptance criteria, and adding it would widen scope past the
  named fields.

## Design Notes

**Resolving an apparent tension in the source spec.** Two passages of
`leadwright/spec/lead-model-spec.md` describe the PO-facing surface
differently: prose at line ~1199 says "two entries in the *existing menu*...
no new bar", while the binding AC table (line 2410, the V3 row, the row that
names this iterate's FR) says "Bot- und BellDot-Knopf im
Werkzeugleisten-Muster" (Bot and BellDot **button** in the toolbar
**pattern**). This iterate's own task brief settles it explicitly in the same
words as the AC-table row — two dedicated toolbar buttons, not two items
added inside `BoardStatusFilter`'s own dropdown — and cites
`BoardStatusFilter.tsx` only as the **menu anatomy** to imitate for the Bot
button's own dropdown, not as the component to modify. Read together, "no
new bar" means: both buttons land in the *same* toolbar row as
`StatusFilterMenu`/`DensityToggle` (no second row of controls), which is
exactly what "in the existing toolbar pattern" describes. No PO clarification
needed — the task brief already disambiguates.

**Bot button** — opens a `BoardStatusFilter`-shaped dropdown
(`LeadTagFilterMenu`) with three checkbox rows, one per tag prefix, each with
a live count: "Lead-originated" (`lead:`), "Waiting on PO" (`lead-wait:`),
"Dedup pending" (`lead-dedup:`). New component
`client/src/components/external/LeadTagFilter.tsx`.

**BellDot button** — a single always-visible toggle (no dropdown) that is a
shortcut for exactly the "Waiting on PO" entry above, sharing the same
`Set<LeadTagPrefix>` filter state as the Bot menu — checking one is reflected
in the other. This matches the source spec's specific callout of "wartet auf
den PO" (waiting on the PO) as its own PO-facing affordance, and BellDot's
notification connotation fits that specific case best.

**Filtering semantics** mirror the existing `statusFilter`: empty selection =
no filtering; a non-empty selection is OR-within-group (task matches if any
selected prefix matches any of its tags via `tag.startsWith(prefix)`). Client
-side, over the already-loaded `tasks` array — no new fetch, no `?tag=` call.

**Expander** — new `TaskCardLeadExpander` in
`client/src/components/external/TaskCardLeadExpander.tsx`, following the
existing `TaskDescriptionDisclosure` local-expand shape (chevron toggle +
conditionally-rendered panel) rather than `SmartViewerModal`'s full dialog —
the brief explicitly wants "an expander ON the card instead of a page
change". Renders nothing when the task has none of `domain` / `priority` /
`complexityHint` / `tags`. The toggle button calls `stopPropagation()` on
click (same pattern already used by the card's failure-notice block and the
existing action buttons) so it never reaches `navigateToDetail`.

**Bot glyph** — a small `Bot` icon (already imported elsewhere in this
codebase: `CampaignAutonomousLaunchButton.tsx`) rendered immediately before
`ProjectPill` inside `TaskCard`'s meta row, gated on `isLeadOriginated(task.tags)`.

**Bloat baseline.** `TaskCard.tsx` (476/300) and `TaskBoardPage.tsx`
(447/300) are both already-grandfathered over-budget entries in
`shipwright_bloat_baseline.json`. New logic is extracted into new files
(`lib/leadTags.ts`, `components/external/LeadTagFilter.tsx`,
`components/external/TaskCardLeadExpander.tsx`,
`components/external/TaskCardProjectPill.tsx`, `hooks/useBoardFilters.ts`) to
keep the growth in the two existing files to thin wiring only. Final state
(after the code-review pass below, which caught a first draft that bumped
the baseline instead of extracting): `TaskCard.tsx` shrinks to 444 lines
(under its 476 baseline — the `ProjectPill` extraction alone did it) and
`TaskBoardPage.tsx` shrinks to 440 lines (under its 447 baseline — folding
the pre-existing inline `statusFilter` state into the same
`useBoardFilters.ts` hook that holds the new lead-tag state did it).
`shipwright_bloat_baseline.json` is therefore **untouched** by this iterate —
no bump, honest or otherwise, was needed once both files were extracted
instead of grown. (An anti-ratchet correction from the internal plan review,
below, applies here too: `_load_baseline` reads the WORKTREE copy, not a
committed one — irrelevant now that no baseline edit ships at all.)

## External Plan Review

Both `openai` and `deepseek` returned `revise` (agreeing, no contradiction) on
the mode=iterate call over this spec + the mini-plan. Findings integrated
into the mini-plan and the Design Notes above:

- `leadTags.ts` helpers must be null/undefined-safe (`tags?: string[] | null`
  treated as no tags) — a pre-existing or mocked `ExternalTask` record must
  not throw the whole board render.
- `leadTagCounts` follows the *same* convention already established by
  `statusCounts`: computed from `projectFiltered` alone (not re-filtered by
  `statusFilter` or by itself), so counts stay stable while the user toggles
  either filter.
- The expander's `stopPropagation()` guard goes on the whole expander
  wrapper (toggle **and** panel), not the toggle button alone — a click
  inside the open panel must not bubble to `navigateToDetail` either.
- `LeadOriginGlyph` is gated on exactly `tag.startsWith("lead:")` — never the
  three-prefix `hasAnyLeadTag` matcher, so a task with only a `lead-wait:` or
  `lead-dedup:` tag (no `lead:` origin tag) does not get a false-positive
  glyph.
- The expander render-gate is "any lead tag present OR any of
  domain/priority/complexityHint set" — not bare `tags.length > 0` (a task
  with only unrelated, non-lead tags must not open an expander with nothing
  meaningful in it).
- BellDot's pressed state is derived read-only from
  `active.has(LEAD_WAIT_TAG_PREFIX)` and its click calls the exact same
  toggle function the menu's checkbox uses — no independent boolean, so
  there is nothing to keep "in sync" (this was already the intended design;
  called out explicitly here because both reviewers flagged the risk).
- The Playwright E2E spec creates its own fixture tasks (via
  `POST /api/external/tasks`) covering all three prefixes plus one ordinary
  task with no lead tag, rather than depending on ambient dev-stack data.
- AC (e)'s server-side `npm run test`/`typecheck`/`lint` are run explicitly
  even though `server/` is untouched by this change.
- `leadOriginId`/`dedupKey` are kept in `leadTags.ts` (not trimmed) because
  the expander has a concrete consumer for both — showing the human-readable
  lead id and dedup key text.
- No `dangerouslySetInnerHTML` / dynamic class construction from tag or
  metadata values — plain JSX text rendering throughout (already the
  intended approach; explicitly noted per the low-severity security finding).
- Bloat-baseline bump (Design Notes above) is kept to the exact measured new
  line counts — no unrelated formatting/cleanup riding along in the same
  commit.

## Internal Plan Review

`opus-plan-reviewer` (opus tier), verdict `revise`, over the already-revised
spec + mini-plan. It confirmed the BellDot reconciliation above and added:
one legibility point already true by construction, and blocking/should-fix
findings acted on before Build:

- **Bot trigger active-dot when BellDot is engaged** — already true by
  construction: `LeadTagFilterMenu`'s dot is `active.size > 0` over the
  *same* `Set` reference BellDot writes into, so engaging BellDot lights the
  Bot dot with no extra code. No action needed; called out here because the
  reviewer asked for it explicitly.
- **`TaskCard.test.tsx` has zero bloat-baseline headroom** (377/377,
  `current` already equals measured) — the planned new glyph/expander/
  navigation-isolation test cases go in a **new** file (`TaskCard.lead.test.tsx`)
  instead of growing it, avoiding a baseline touch entirely for that file.
- **`TaskCard.tsx` bloat: extract instead of bump.** `ProjectPill`
  (`:410-450`, ~41 lines) moves to its own file
  (`TaskCardProjectPill.tsx`) — self-contained, no behavior change — which
  gives this iterate's own +10-15 lines of wiring room to land *without*
  raising `TaskCard.tsx`'s baseline `current` at all. This also sidesteps a
  real, separately-flagged problem: `shipwright_bloat_baseline.json` is a
  DO-NOT #30 PR-Review sensitive path, so touching it would force a
  mandatory Tier-3a review regardless of size. The reviewer additionally
  corrected the spec's original (wrong) claim about *why* a same-commit bump
  would be safe — the anti-ratchet hook reads the baseline from the
  **worktree**, not from staged/committed content
  (`anti_ratchet_check.py:_load_baseline` calls `target.read_text(...)`,
  not `git show`); only the measured file uses the staged/worktree split.
  The conclusion (extract, don't bump) stands regardless.
- **Keyboard propagation reaches dnd-kit, not just `navigateToDetail`.**
  `TaskCard` is rendered inside `DraggableCard`
  (`TaskBoardColumns.tsx:143-159`), which spreads `useDraggable`'s
  `{...listeners}` (including a `KeyboardSensor`) onto an outer wrapper
  `TaskCard` doesn't control. `stopPropagation()` on click alone (8px
  `PointerSensor` activation distance) doesn't cover Enter/Space on the
  expander toggle, which would otherwise bubble into that listener — the
  same bubbling class already fixed once for the `⋯`-menu at
  `TaskCard.tsx:158-166`. Fix: `onKeyDown` `stopPropagation()` on the
  expander wrapper too; AC (b) extended to assert Enter/Space on the toggle
  expands the panel, does not navigate, and does not initiate a drag.
- **Case sensitivity.** The server's own `?tag=` test fixture
  (`routes.lead-fields-tag-filter-list.test.ts:31`) is explicitly
  case-sensitive. `tag.startsWith(prefix)` is case-sensitive by construction
  (no `.toLowerCase()` anywhere in `leadTags.ts`) so the two filter surfaces
  already agree — a test pins it explicitly rather than leaving it implicit.
- **`seedTask()` (`client/e2e/helpers/fixtures.ts`) has no `tags` param** —
  extended with an optional `tags?: string[]` passed through to
  `createExternalTask` (the wire API already accepts it), budgeted into the
  E2E authoring step rather than assumed free.
- **Visual regression baselines** — `client/e2e/visual/01-board.spec.ts`
  (`board.png`, full-page, covers the `PageHead` toolbar) and
  `08-launch-states.spec.ts` will shift because the two new buttons land in
  that exact toolbar region. Per project convention (`memory:
  project_visual_baselines_linux_regen_flow`) baselines regenerate on Linux
  only — regenerated as part of F0.5/E2E execution, not deferred.
- **Zero-match board state** (non-blocking, folded in anyway — this iterate
  adds a third filter axis plus a one-click BellDot toggle, making an
  accidental zero-result view easy to hit): `TaskBoardPage` gates its
  teaching empty state on `projectFiltered.length === 0` only; a minimal
  "no tasks match the current filters" row is added for the
  filtered-to-zero-but-not-actually-empty case.
- **Phone width (DO-NOT #26 amendment area)** — considered, not changed:
  `ViewToggle`, `StatusFilterMenu` and `DensityToggle` already render
  unconditionally on phone width in the current code (only
  `ProjectFilterDropdown`/`ComplianceGradeBadge` are `!isPhone`-gated); the
  two new `h-8 w-8` icon buttons follow that same existing precedent rather
  than introducing new phone-specific hiding logic, which would itself be
  unbudgeted, untested surface this iterate doesn't need.
- **`doc-sync.test.ts` `REQUIRED_TOKENS`** — the new files
  (`leadTags.ts`, `LeadTagFilter.tsx`, `TaskCardLeadExpander.tsx`,
  `TaskCardProjectPill.tsx`) are added to it and to
  `component_inventory.md` per its own documented convention.
- **Not adopted as new scope:** the `leadOriginId`/`dedupKey` href/src/style
  injection caution and the unbounded-tag-length truncation note are real
  but forward-looking (no link/style ever consumes these values in this
  iterate); addressed with `break-all` on the dedup/origin text spans and a
  code comment for the next iterate that does wire a link, rather than new
  ACs for a risk this change doesn't yet create.

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-01-lead-board-surface/architecture_brief.md`
- **Verdicts:** deepseek=revise · openai=revise (agree, no contradiction)
- **Smallest thing that would do (per reviewers):** fold "waiting on PO" into
  the single Bot dropdown as one more checkbox row; drop the standalone
  BellDot button entirely — it duplicates one Bot-menu entry and adds a
  second permanent control that must be kept in sync with the first.
- **Findings:** simpler-alternative / medium (both reviewers, independently)
  — BellDot is a redundant standing affordance for the same filter state as
  a Bot-menu checkbox.
- **Reconciliation:** **Not adopted — BellDot is kept.** The reviewers were
  not shown (by design — the brief format withholds it) that "Bot and
  BellDot button in the existing toolbar pattern" is an explicit, named
  deliverable from two authoritative sources: this iterate's own task brief,
  and the binding AC-table row for FR-04.11 in
  `leadwright/spec/lead-model-spec.md` (line 2410), which literally reads
  "Bot- und BellDot-Knopf im Werkzeugleisten-Muster" (Bot **and** BellDot
  button in the toolbar pattern). Dropping BellDot would mean not building
  what was asked. The underlying *technical* risk both reviewers actually
  raised — two controls that can desync — is real and is addressed anyway
  (see External Plan Review above): BellDot carries no state of its own, it
  is a second read/write view onto the exact same `Set<LeadTagPrefix>` and
  calls the exact same toggle function the menu's checkbox does, so there is
  nothing that *can* desync. The reviewers' engineering concern is resolved
  without dropping the requirement that prompted it.

## Affected Boundaries
n/a — no serialized-format producer/consumer changes. This iterate only
*reads* fields (`tags`, `domain`, `priority`, `complexityHint`) that another
iterate (2026-05-14-lead-foundation-task-schema) already produces and
persists; no new boundary is created.

## Confidence Calibration
- **Boundaries touched:** none — `tags` is an existing persisted field (PATCH
  `/tasks/:id` already validated/normalized it pre-iterate); this change adds
  only a new client-side reader of it, no new producer/consumer pair.
- **Empirical probes run:** component tests are the probes for this UI-only
  change — Bot menu open/toggle/reset (`LeadTagFilter.test.tsx`), BellDot
  shared-state entanglement in both directions (`useBoardFilters.test.ts`),
  expander open/close + click-AND-keydown propagation isolation against a
  simulated dnd-kit ancestor listener (`TaskCard.lead.test.tsx`,
  `TaskCardLeadExpander.test.tsx`), glyph presence/absence gated strictly on
  the `lead:` prefix (not the broader `hasAnyLeadTag`), and null/undefined
  `tags` handling (`leadTags.test.ts`). A real-browser Playwright pass
  (`lead-board-surface.spec.ts`) additionally proves the same behaviors
  survive actual DOM event dispatch and real navigation — jsdom's
  `fireEvent`/`userEvent` can pass while a real click still resolves against
  the wrong element (e.g. the Radix portal-overlay finding fixed during this
  run, see Verification below).
- **Test Completeness Ledger:**
  | Behavior | Category | Test |
  |---|---|---|
  | Null-safe tag predicates (undefined/null/empty/case-sensitivity) | edge-case | `leadTags.test.ts` |
  | Bot menu filters by each of 3 prefixes + "All" reset | happy-path | `LeadTagFilter.test.tsx` |
  | BellDot ⇄ Bot-menu shared-state entanglement (both directions) | integration | `useBoardFilters.test.ts` |
  | Glyph shows for `lead:` only, not `lead-wait:`/`lead-dedup:` alone | edge-case | `TaskCard.lead.test.tsx` |
  | Expander render-gate (no lead tag AND no domain/priority/complexityHint → null) | edge-case | `TaskCardLeadExpander.test.tsx` |
  | Card-click still navigates outside the expander | regression | `TaskCard.lead.test.tsx` |
  | Expander click/keydown does not navigate or reach a dnd-kit ancestor listener | edge-case | `TaskCard.lead.test.tsx`, `TaskCardLeadExpander.test.tsx` |
  | Full end-to-end filter → card → expander → still-navigates flow, real browser | happy-path | `client/e2e/flows/lead-board-surface.spec.ts` |
- **Confidence-pattern check:** no hedge language ("should work", "I believe")
  in this spec or the commit; every claim above is backed by a named,
  executed test file. The one genuine unknown at plan time — whether
  `stopPropagation` on the toggle alone was sufficient — was resolved by
  internal plan review (see below) before Build, not discovered late.

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright E2E — new
  `client/e2e/flows/lead-board-surface.spec.ts` run against the dev stack
  (`npx playwright test flows/lead-board-surface.spec.ts`), covering: Bot menu
  filters by each of the three tag prefixes, BellDot toggles the "waiting on
  PO" filter in sync with the Bot menu, the card expander opens in place, and
  clicking the card body (outside the expander) still navigates to
  TaskDetail. Component-level Vitest coverage (`LeadTagFilter`,
  `TaskCardLeadExpander`, `TaskCard`, `TaskBoardPage` wiring) is authored
  first as the TDD red/green loop and stays as regression coverage; the E2E
  spec is the medium+ web-surface verification the Phase Matrix requires
  ("always" — author AND execute) on top of it.
- **Evidence path:** Playwright HTML report + `client/` Vitest output, both
  captured at F0.5.
- **Visual-regression impact:** the new Bot/BellDot toolbar buttons render
  unconditionally next to `StatusFilterMenu` (no lead-tagged seed data is
  required to trigger them), so both existing `fullPage` board baselines
  shift: `client/e2e/visual/01-board.spec.ts` → `board.png` and
  `client/e2e/visual/08-launch-states.spec.ts` → `board-launch-failed.png`.
  `task-detail-launch-failed.png` (same file) is on the TaskDetail route,
  which renders neither the toolbar nor `TaskCard` — unaffected.
  Baselines are Linux-only (project convention); regenerate via the
  project's Linux baseline-regen flow, not a local Windows run.
- **E2E execution result:** authored and run against the isolated E2E stack
  (`node e2e/isolated-stack.mjs --project=chromium flows/lead-board-surface.spec.ts`).
  First run found one real bug in the spec itself (not the feature): a
  re-click on the already-open Bot-menu trigger fought Radix's own dismiss
  layer (`<html>` intercepted the pointer event) because the checkbox item's
  `preventDefault` keeps the menu open — fixed by interacting with the
  still-open menu directly instead of re-opening it. All 3 tests green after
  the fix.

## Self-Review
Run after implementation, before commit (mandatory, all complexity levels).
Full 8-point payload recorded via `record_review_pass.py` at
`.shipwright/planning/iterate/iterate-2026-09-01-lead-board-surface/self-review.json`.

  1. Spec Compliance:     pass — Bot+BellDot filter by the 3 closed prefixes, expander opens in place, glyph gated on `lead:` origin only; no 4th prefix, no new persisted field.
  2. Error Handling:      pass — no new server boundary; `leadTags.ts` helpers are null-safe (`tags?: string[] | null`) and unit-tested for undefined/null.
  3. Security Basics:     pass — plain JSX text rendering throughout, no `dangerouslySetInnerHTML`; a code comment flags untrusted tag-derived strings for any future href/src/style consumer.
  4. Test Quality:        pass — assertions target rendered DOM/behavior; every new module has both a happy-path and an edge-case test.
  5. Performance Basics:  pass — client-side `useMemo` filtering over the already-fetched task list; no new network calls.
  6. Naming & Structure:  pass — new files follow existing directory conventions. (Updated post-code-review: `TaskBoardPage.tsx` and `TaskCard.tsx` both extract BELOW their bloat-baseline `current` values — see `## Code Review` below — so `shipwright_bloat_baseline.json` is untouched, not bumped.)
  7. Affected Boundaries: n/a — `tags` is an existing persisted field; this change only adds a new client-side reader, no new producer/consumer pair.
  8. Test Hygiene Probe:  pass — `scan_test_hygiene.py --diff` reported no findings.

Action: All clear, proceed to commit / Step 8 review cascade.

## Code Review

**Stage 1 (`spec-reviewer`, HARD-GATE): PASS.** Zero spec citations — all five
ACs verified against the diff, both Traps intact (whole-card navigation
unbroken; client-side filtering only, `?tag=` untouched), nothing from Out of
Scope implemented. Full report recorded in this run's review ledger
(`.shipwright/planning/iterate/iterate-2026-09-01-lead-board-surface/reviews.json`,
`spec-review.json` payload).

**Stage 2 (`code-reviewer`): 13 findings, all resolved before commit** (this
is a standalone iterate, not campaign mode — Step 8 runs the cascade itself,
before F6). One HIGH, two MEDIUM, ten LOW/non-blocking:

- **HIGH — bloat-baseline anti-ratchet violation, fixed by extraction, not
  argument.** The first draft bumped `TaskBoardPage.tsx`'s baseline entry
  447→489 instead of extracting, the exact treatment this same spec's
  Internal Plan Review had already mandated for `TaskCard.tsx`'s twin case
  ("extract instead of bump ... touching the baseline would force a
  mandatory Tier-3a review regardless of size") — TaskCard got that
  treatment, TaskBoardPage did not. Fixed: folded the pre-existing inline
  `statusFilter` state into the same `useBoardFilters.ts` hook that already
  held the new lead-tag state (renamed from `useLeadTagFilter.ts`), landing
  `TaskBoardPage.tsx` at 440 lines — under its 447 baseline.
  `shipwright_bloat_baseline.json` reverted to no-op; the stale Design Notes
  paragraph claiming a same-commit bump is "the sanctioned path" (a claim
  the Internal Plan Review had already corrected once, for the file-read
  question, not the policy question) is corrected above.
- **MEDIUM — `LeadTagFilterMenu`'s "All" count was wrong.** It summed the
  three per-prefix counts, which is only valid for `StatusFilterMenu`'s
  disjoint/exhaustive state buckets — lead-tag prefixes can overlap (one
  task, two tags) and are not exhaustive (an ordinary task has none), so the
  sum double-counted and under-represented. Fixed: `LeadTagFilterMenu` now
  takes an explicit `total` prop; `useBoardFilters` reports
  `leadTagTotal: projectFiltered.length` directly rather than deriving it
  from the buckets. Test rewritten to assert a value distinct from the
  bucket sum, with a multi-prefix task present.
- **MEDIUM — `TaskBoardNoFilterMatches` had zero coverage**, including the
  branch-ordering invariant that makes it correctly preempt both board and
  list view (it sits above the `view === "list"` ternary — correct today,
  undocumented in code, breakable by a future reorder). Fixed: added an E2E
  case exercising BellDot → zero matches → the affordance visible in BOTH
  `?view=list` and default board view → clear → the card returns.
- **LOW — inconsistent null-safety in `leadTags.ts`.** `hasPrefix` guarded
  each tag element (`typeof t === "string"`); `matchesAnyLeadPrefix` (the
  highest-traffic path — runs per task per render) and `leadOriginId`/
  `dedupKey` did not. Fixed: all three now route through `hasPrefix`
  (exported) / a new `firstWithPrefix` helper.
- **LOW — `stopPropagation` coverage gap on `TaskCardLeadExpander`'s
  wrapper.** Missing `onPointerDown` (a press-and-drag starting on the
  toggle/panel could still initiate a card drag past the sensor's 8px
  activation distance) and over-broad on `onKeyDown` (stopped every key,
  silently swallowing the window-level `i`/New-Iterate shortcut while focus
  sat on the toggle). Fixed: added `onPointerDown` to the same stop; narrowed
  `stopKey` to only `Enter`/`Space`/`Arrow*`.
- **LOW — dead guard.** The toggle button's own `stop(ev)` was unreachable
  (the wrapper's `onClick` already stops it first) — two overlapping guards
  for one path, inviting deletion of the load-bearing one. Fixed: removed
  the redundant call from the button.
- **LOW — `LeadOriginGlyph` accessibility.** `aria-hidden="true"` removes the
  whole subtree (including `title`) from assistive tech, but this glyph is
  the SOLE signal a card is lead-originated. Fixed: `role="img"` +
  `aria-label` on the wrapper, `aria-hidden` moved to the decorative icon
  only.
- **LOW — `PRIORITY_CLASS` typed as `Record<string, string>`** instead of the
  model's closed union, making the map non-exhaustive-checked and its `??`
  fallback unreachable dead code. Fixed: narrowed to
  `Record<NonNullable<ExternalTask["priority"]>, string>`, fallback removed.
- **LOW — `matchesAnyLeadPrefix`'s `prefixes` parameter widened to
  `Iterable<string>`** in the one module whose premise is a closed
  vocabulary. Fixed: narrowed to `Iterable<LeadTagPrefix>`.
- **LOW — `useLeadTagFilter`'s count seed needed an unsafe `as` cast** and
  the per-prefix loop allocated a throwaway array per task per prefix.
  Fixed as part of the `useBoardFilters` merge: literal object seed (matches
  the pre-existing `statusCounts` convention exactly, no cast), loop calls
  the exported single-prefix `hasPrefix`.
- **LOW — test duplication + a coverage gap, in the same finding.**
  `TaskCard.lead.test.tsx`'s "bot glyph" and "render-gate" blocks duplicated
  `TaskCardLeadExpander.test.tsx` byte-for-byte, while AC (c)'s actual claim
  — the glyph renders "next to" the ProjectPill — was asserted nowhere (both
  suites stayed green if the glyph moved elsewhere on the card). Fixed:
  replaced the duplicated blocks with one DOM-adjacency assertion
  (`glyph.nextElementSibling === pill`) plus one "mounted in the real card"
  smoke case; the vocabulary-gating matrix stays in the unit file only.
- **Non-blocking (recorded, not acted on this iterate) — `LeadTagFilterMenu`
  is a near-verbatim clone of `StatusFilterMenu`.** The reviewer's own note:
  refactoring would touch `BoardStatusFilter.tsx`, out of this iterate's
  scope, and the spec explicitly chose "mirror BoardStatusFilter's menu
  anatomy". Left as-is; a future generic `IconCheckboxFilterMenu` extraction
  is a candidate for whichever iterate next touches either menu — not filed
  as a standalone triage card per this project's "don't reflexively create
  triage items" convention, since nothing here is actionable in isolation
  from that future touch.

All fixes verified: `npm run test`/`typecheck`/`lint` green in `client/`
after the changes (re-run below), plus the extended E2E spec.

**Stage 3 (`doubt-reviewer`): `not_applicable`.** The diff is pure
client-side UI + fixtures + docs — no migrations, async/concurrency,
cross-plugin imports, or irreversible ops, the trigger conditions for this
stage.

**External code-review cascade (`external_review.py --mode code`, two
providers via OpenRouter): `revise`.** `openai` returned a verdict of
`revise` with two LOW test-quality findings; `deepseek` returned an empty
reply (`status: degraded`, `reason: "provider returned an empty reply"`) —
recorded as `verdicts.deepseek: "unavailable"`, not treated as a silent
pass. Both `openai` findings were real gaps, not false positives, and were
fixed:

- **LOW — `useBoardFilters.test.ts`'s `leadTagTotal` test didn't distinguish
  the correct total from the exact bug the Stage-2 fix above corrected.**
  With the original 3-task fixture, `sumOfBuckets` and `leadTagTotal` both
  evaluated to `3` — a regression back to `leadTagTotal: sumOfBuckets` would
  have passed. Fixed: added a second ordinary (no-lead-tag) task so the two
  values diverge (`sumOfBuckets: 3`, `leadTagTotal: 4`), and asserted the
  divergence directly instead of only asserting `leadTagTotal` against a
  hardcoded number.
- **LOW — the claimed Bot-menu ⇄ BellDot state-sync test only exercised
  one direction.** `LeadTagFilter.test.tsx`'s "stays in sync" case rendered
  `LeadWaitToggleButton` alone and re-rendered it with a manually-swapped
  prop — it never mounted `LeadTagFilterMenu` or clicked its `lead-wait:`
  checkbox, so a real wiring regression (menu selection not reaching
  BellDot) could still pass. Fixed: added an integration test mounting both
  components against one shared `useBoardFilters()` call, clicking the
  menu's `lead-wait:` item, and asserting `BellDot`'s `aria-pressed` flips —
  the existing unidirectional test is kept as the inverse-direction case.

Both fixes verified green (`useBoardFilters.test.ts` + `LeadTagFilter.test.tsx`
in isolation, then the full `client/` + `server/` `test`/`typecheck`/`lint`
suites — see Verification below). Recorded in the review ledger as
`external_code: completed` (`external-code-review.json`,
`external_code_review_state.json`).
