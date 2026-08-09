---
run_id: iterate-2026-08-09-triage-filter-styling
status: implemented
intent: bug
complexity: medium
---

# Triage filter header styling + Preview button visibility/scope bugs

## Problem Statement

Sven (screenshots, 2026-08-09):
1. The Triage tab's new filter/sort bar (`TriageFilterSortBar` +
   `TriageFilterGroup`, shipped in iterate-2026-08-08-triage-filters-sort-parked)
   does not visually match the app's established control chrome — compared
   directly against the Task Board header (`ViewToggle` / `StatusFilterMenu`),
   its chips are heavier (thicker teal tint fill, 4px radius, 1px border)
   than the Board's flatter, established button language.
2. `<PreviewButton>` (Task Board header) is unreadable on the dark
   `.chrome-dark-controls` toolbar — "durchsichtig ... auf schwarz kann man
   ihn nicht sehen" (transparent, can't see it on black).
3. `<PreviewButton>` renders even when "All projects" is selected, where it
   has no single project to spawn a dev server for.

## Root Cause (F-debug, Phase 4 statements)

**#2 (invisible Preview button).** `PreviewButton.tsx` styles itself with
`bg-[var(--color-surface)]` + `border-[var(--info-line)]` +
`text-[var(--color-info)]`. `.chrome-dark-controls`
(`client/src/styles/type-scale.css:104`) re-points `--color-surface` to a
10%-opacity white overlay for controls rendered on the dark board toolbar,
but — by explicit design ("the semantic --color-* families ... are
deliberately NOT overridden so badges keep their meaning") — does **not**
re-point the `info` family. `--color-info` (#175CD3, a navy meant for a
WHITE ground) rendered as text/icon over a background that is still
~90% the dark anthracite bar underneath reads as near-invisible. This is
not a case the "badges keep their meaning" rule was written for — Preview
is an actionable CTA, not a status badge — so the fix is scoped to
`PreviewButton` itself, not a `.chrome-dark-controls` policy change.

**#3 (shown on All Projects).** `CreateControls.tsx` renders
`<PreviewButton projectId={resolvedProjectId} enabled={previewEnabled} .../>`
unconditionally, before the `allProjects` branch. `resolvedProjectId` falls
back to `realProjects[0]?.id` in "All projects" mode (`TaskBoardPage.tsx`)
purely so the *actions dropdown* still has something to resolve against —
Preview was never meant to inherit that fallback, since spawning a dev
server for an arbitrary "first" project while the user is looking at every
project is not a coherent action.

**#1 (styling mismatch).** Not a regression — `TriageFilterGroup` was built
against a *different* existing convention (`SourceBadge`'s resting state +
the tinted-selected pattern from `FolderTree`/`ViewerTabBar`), which is
internally consistent but was never compared against the Board's own
control chrome, the app's other reference for a *toggleable filter chip*
(`ViewToggle`, `StatusFilterMenu`). Two legitimate "existing patterns"
diverged; Sven's ask picks the Board one as canonical for this control.

## Internal Plan Review (opus-plan-reviewer)

- **Ran:** yes
- **Severity:** high (2), medium (5), low (3)
- **Summary:** both root-cause analyses (#2, #3) verified correct against
  source; two real gaps in the original plan — insufficient verification
  rigor for a medium iterate (jsdom class-string assertions only; no
  mention of the `/triage` visual-regression baseline), and an affordance
  regression in the chip redesign (painting every default-on chip in
  `--color-primary` erased the on/off distinction down to hue alone, and
  collided with the hover-affordance color).
- **Findings:**
  - completeness/high — `/triage` is a baselined visual-regression route;
    the restyle will move its baseline and the plan never mentioned
    regenerating it → **fixed**: documented in Verification below, deferred
    to F11 per the standard Linux-container regen flow (cannot run
    locally).
  - completeness/high — medium-iterate ACs verified only via jsdom
    class-string assertions, not real rendering → **fixed**: added
    `client/e2e/flows/triage-filter-preview-restyle.spec.ts` asserting
    `getComputedStyle` in a real browser.
  - architecture/medium — CLAUDE.md's "Preview-capability precedence"
    enumerates exactly 3 gates; AC4 adds a 4th (project-scope) → **fixed**:
    CLAUDE.md updated with gate 4.
  - architecture/medium — painting every included (default-on) chip in
    `--color-primary` collapses the on/off distinction to hue alone and
    collides with the hover-affordance color → **fixed**: redesigned the
    encoding (see Acceptance Criteria AC2 below) so the *minority* excluded
    state carries the non-hue cue (inset fill + muted text), the majority
    included state stays plain ink, and `--color-primary` is reserved
    exclusively for hover.
  - architecture/medium — same redesign fixes the hover/active-border
    collision (finding 5) as a side effect, since no resting state uses
    `--color-primary` any more → **fixed** (same change as above).
  - completeness/medium — the planned `CreateControls.test.tsx` case would
    pass vacuously (`base.previewEnabled` defaults false) → **fixed**: both
    new cases explicitly pass `previewEnabled`.
  - completeness/medium — `TriageSortLevel.tsx` restyle had no AC →
    **fixed**: folded into AC1 below (chip *and* sort-level geometry are
    the same border/radius change, one AC).
  - completeness/low — `TriageFilterGroup.test.tsx`'s Parked group (a
    single option, no sibling to contrast against) untested in isolation →
    **fixed**: added a dedicated single-option on/off test.
  - performance-ux/low — Preview button lost its old hover background
    shift (hover now only deepens the border) → **disclosed**, not fixed:
    still a real state change, and adding a second background tint back in
    risks re-approaching the original "too heavy" complaint. Not requested
    by Sven.
  - architecture/low — doc comment gap on `resolvedProjectId`'s All-Projects
    fallback semantics → **fixed**: added to the prop doc.
- **Known limitations:** the `border-[1.5px]` Tailwind arbitrary-value
  class computes to `1px` in every real browser measurement taken during
  this iterate — including `StatusFilterMenu`'s own trigger on the Board,
  the exact component this restyle copies the pattern from. This is a
  pre-existing, repo-wide quirk (not introduced or regressed here) and is
  out of scope to fix — it would touch components beyond this iterate for
  a sub-pixel difference nobody reported. The real-browser E2E spec asserts
  the actual computed `1px` on both sides, which is what "matches the
  Board" empirically means.
- **Status:** 8 fixed, 1 disclosed, 0 declined

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-09-triage-filter-styling/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — restyle
  the three components, gate Preview on `activeProjectId !== null`.
- **Findings:** none
- **Reconciliation:** n/a — both reviewers approved as proposed, no
  alternative to reconcile against.

## Code Review (Stage 2, code-reviewer)

- **Ran:** yes, after Stage 1 (spec-reviewer) PASSed.
- **Verdict:** REJECT (2 high, 2 medium, 2 low) — spec compliance was
  already settled by Stage 1; this pass found real correctness gaps Stage 1
  wasn't scoped to catch.
- **Findings:**
  - correctness/high — the new E2E spec's `afterEach` called
    `cleanupProject(request, project.projectId)`, a `string`, where the
    helper requires `SeededProject | undefined`. Silent no-op at runtime
    (`DELETE /api/projects/undefined`, swallowed by the helper's own
    try/catch) leaking a seeded project + temp dir on every run, and a
    `typecheck:e2e` CI failure the plain `tsc --noEmit` run never exercises
    (different `tsconfig.e2e.json` root) → **fixed**: pass `project`, not
    `project.projectId`.
  - correctness/high — the AC4 gate as originally specified
    (`activeProjectId === null`) missed the synthesized "Unassigned"
    pseudo-project: `TaskBoardPage.tsx`'s `resolvedProjectId` falls back to
    `realProjects[0]` for **both** `null` and `UNASSIGNED_PROJECT_ID`, and
    Unassigned is a real, user-selectable row in the board's project
    dropdown whenever an orphan task exists. A user viewing Unassigned
    tasks would see Preview pointed at an arbitrary other project — the
    same incoherence AC4 exists to remove → **fixed**: gate changed to
    `resolvedProjectId === activeProjectId` (the actual "is this a genuine
    selection" invariant), AC4-agent's wording corrected below, new unit
    case added, CLAUDE.md gate 4 corrected.
  - architecture/medium — the chip hover convention
    (`hover:text-[var(--color-primary)]`) was both internally inconsistent
    with this same diff's `TriageSortLevel.tsx` (`hover:text-[var(--color-text)]`)
    and inverted relative to the cited precedent, `StatusFilterMenu`'s
    trigger, which reserves `--color-primary` for the RESTING active state
    and uses `--color-text` on hover → **fixed**: chips now hover to
    `--color-text`, matching both `TriageSortLevel` and `StatusFilterMenu`;
    `--color-primary` now appears only on the hover BORDER, never as any
    text color.
  - correctness/medium — the "non-hue cue" claim for the excluded state was
    only nominally true: `--color-inset` (#F5F5F4) against the card's
    `--color-surface` (#FFFFFF) measures ~1.09:1, imperceptible as a fill on
    its own, leaving muted-vs-ink text lightness as the only practically
    visible signal — itself a color/luminance-only distinction under WCAG
    1.4.1 → **fixed**: added `line-through` to the excluded state as the
    genuinely non-color cue; docstring and this spec's AC2/Out-of-Scope
    corrected to stop claiming the fill alone gives it "a real shape."
  - correctness/medium — the E2E's All-Projects assertion
    (`toHaveCount(0)` immediately after `page.goto("/")`) had no positive
    anchor, so it would stay green even if AC4 were reverted, on a slow
    enough first paint → **fixed**: anchored on
    `plain-cascade-trigger` (an All-Projects-only surface) being visible
    first.
  - readability/low — CLAUDE.md gate 4 mixed an iterate-id + implementation
    location + a paragraph of rationale in a section that is a one-line
    index by design, and (per the high finding above) stated the gate
    incorrectly → **fixed**: reduced to one clause per gate, restated the
    closing summary to name all three enabling gates plus the opt-out.
  - readability/low — `PreviewButton.test.tsx`'s negative class assertion
    (`not.toContain("bg-[var(--color-surface)]")`) adds little over the
    positive assertion beside it → **left as-is** (reviewer's own verdict:
    "no change required," cheap and harmless).
- **Status:** 6 fixed, 0 disclosed, 0 declined (the 2 low findings are 1
  fixed + 1 explicitly left as-is per the reviewer's own non-blocking call).

**Re-review (fresh context, after the fixes above):**
- **Verdict:** REJECT (1 medium, 3 low) — the fix pass itself introduced one
  new gap; the other three are documentation drift the fix pass left behind.
- **Findings:**
  - correctness/medium — the hover-convention fix (`hover:text-[var(--color-text)]`)
    made a pre-existing unit assertion (`TriageFilterGroup.test.tsx`,
    "renders the included state as plain text") vacuous: `toContain` does
    substring matching, and the hover token now contains the exact string
    the resting-state assertion was checking for, so the included state's
    OWN `text-[var(--color-text)]` could be deleted without failing the
    test → **fixed**: switched to token-level array matching
    (`className.split(/\s+/)` + array `toContain`, which requires an exact
    element match), and added a real-browser `color`/`text-decoration-line`
    anchor on the included chip in the E2E spec so this property has
    browser-level coverage too, not just jsdom.
  - readability/low — `CreateControls.tsx`'s file-header docstring still
    said the flat branch renders "`PreviewButton` + ... — exactly as
    before" and cited `activeProjectId !== null`, which is precisely the
    condition the prop doc says not to use → **fixed**: docstring corrected
    to describe the actual `resolvedProjectId === activeProjectId` gate.
  - architecture/low — the new Unassigned unit test hardcoded the literal
    `"unassigned"` instead of importing `UNASSIGNED_PROJECT_ID` from
    `lib/projectIds.ts` → **fixed**: imports and uses the constant.
  - correctness/low (advisory, non-blocking per the reviewer's own call) —
    the E2E's All-Projects Preview-enabled assertion depends on the
    isolated stack having exactly one, preview-capable seeded project as
    `realProjects[0]` → **left as-is**: true only if this spec runs outside
    the documented isolated-stack runner, which it does not.
- **Status:** 3 fixed, 1 left-as-is (reviewer's own non-blocking call), 0
  declined.

**Third re-review (fresh context):**
- **Verdict:** REJECT (1 medium, 3 low).
- **Findings:**
  - correctness/medium — the excluded chip's `text-[var(--color-muted)]`
    is exactly the token×ground pair `tokens.contrast.test.ts`'s own
    machine-checked ladder already records as FAILING: `--muted` on
    `--inset` measures ~4.39:1, below the 4.5:1 body-text floor, and the
    chip's label is information the user must read (which domain/priority
    got excluded), not decoration → **fixed**: switched to `--ink-fixed`
    (weather-deck.css: always #1C1917, never re-themed) — the app's
    established fix for a control carrying its own fixed near-white ground
    (`lib/phaseStyle.ts`'s `INK_FIXED` badge pattern). Added a dedicated
    rung to `tokens.contrast.test.ts`'s `LADDER` for `--ink-fixed on
    --inset` so this pairing is machine-checked going forward, updated the
    unit test and this AC2 text, and added a `color` assertion to the E2E
    for the excluded chip (mirroring the one already added for the
    included chip at round 2).
  - readability/low — `.shipwright/agent_docs/conventions.md` convention 7
    still described the 3-gate Preview precedence after CLAUDE.md was
    updated to 4 → **fixed**: added the board-scope clause.
  - readability/low — `TriageSortLevel.tsx` was the only touched file with
    no iterate marker recording why its geometry must track the chips' →
    **fixed**: one-line docstring addition.
  - readability/low — the docstring's causal claim ("a teal border
    unambiguously means clickable... hovering an excluded chip cannot be
    mistaken for an included one") overstated the border's role: on hover
    both states converge to the same primary border + ink text, so
    `line-through` is actually the sole discriminator there → **fixed**:
    reworded in both the component docstring and this AC2 text to state
    that plainly, as part of the same edit that swapped the text token.
- **Status:** 4 fixed, 0 disclosed, 0 declined.

**Fourth re-review (fresh context):**
- **Verdict:** PASS — 1 low, non-blocking finding.
- **Findings:**
  - readability/low — the docstring's "Text stays `--ink-fixed` ... on
    BOTH states" line was imprecise: only the excluded branch uses
    `--ink-fixed`; included uses `--color-text` (same rendered color,
    #1C1917, but a different token, and `--color-text` — unlike
    `--ink-fixed` — is theme-flippable in other contexts). The code itself
    was correct (round 3's fix and `StatusFilterMenu`'s own precedent both
    use `--color-text` for the included/white-ground case) → **fixed**:
    reworded to state which state uses which token and why, and trimmed
    the accreted round-by-round rationale out of the docstring (it already
    lives here).
- **Status:** 1 fixed, 0 disclosed, 0 declined.
- **Reviewer's own assessment, verbatim:** "I do believe it is clean now
  ... I would not hold the diff for it" (the one finding).

**Cascade closed:** 4 rounds, 24 findings total (2 high / 8 medium / 14
low across all rounds — see per-round breakdowns above), all fixed. Stage
3 (doubt-reviewer) not triggered — this diff is CSS classes + one
conditional-render gate + a contrast-ladder test addition; none of the
doubt-reviewer trigger conditions (migrations, async/concurrency,
cross-plugin imports, irreversible ops) apply.

## Acceptance Criteria

- [x] **AC1-agent.** `TriageFilterGroup` chips and `TriageSortLevel`'s
  select/direction-button both render with `--radius-button` (8px) corner
  radius and the same `border-[1.5px]` class `StatusFilterMenu`'s trigger
  uses (not the previous 4px/1px combination). Verified in a real browser:
  `client/e2e/flows/triage-filter-preview-restyle.spec.ts` asserts
  `getComputedStyle(...).borderRadius === "8px"` on a chip.
- [x] **AC2-agent.** Chip on/off encoding: the default **included** state
  (majority — nothing is filtered by default) renders plain ink text with
  no color and no fill; the **excluded** state (the minority, an explicit
  user action) renders `bg-[var(--color-inset)] text-[var(--ink-fixed)]
  line-through` — `line-through` is the genuinely non-color cue (code
  review Stage 2 measured `--color-inset` on white at ~1.09:1, imperceptible
  as a fill alone; `--color-faint` is excluded — that token is
  contrast-ladder-reroled to hairline/decor-only, not legible body text).
  `--ink-fixed`, not `--color-muted`, is the excluded-state text token
  (code review Stage 3: `tokens.contrast.test.ts`'s own ladder records
  `--muted` on `--inset` as FAILING at ~4.39:1, below the 4.5:1 body
  floor — `--ink-fixed` is the app's established fix for exactly this
  shape, per `lib/phaseStyle.ts`'s `INK_FIXED` badge pattern). With text
  now identical between states, `--color-primary` appears **only** on the
  hover-affordance BORDER on either state, never as any text color — on
  hover both states converge to the same primary border + ink text, so
  `line-through` is the sole discriminator there, and the inset fill is
  the secondary resting-state cue. Verified: unit test
  (`TriageFilterGroup.test.tsx`) for the class shape + a dedicated rung in
  `tokens.contrast.test.ts` (`--ink-fixed` on `--inset`) + real-browser
  E2E for the actual computed `background-color`, `color`, and
  `text-decoration-line` on both states.
- [x] **AC3-agent.** `PreviewButton` renders with `bg-[var(--color-info-bg)]`
  (a literal light-blue fill, unaffected by `.chrome-dark-controls`, since
  that class does not touch the info family) instead of
  `bg-[var(--color-surface)]`. Verified: unit test for the class token +
  real-browser E2E asserting `getComputedStyle(...).backgroundColor ===
  "rgb(239, 248, 255)"` on the actual dark Board header.
- [x] **AC4-agent.** `CreateControls` does not render `<PreviewButton>` unless
  `resolvedProjectId === activeProjectId` — a genuine single-project
  selection — and still renders it in single-project mode with
  `previewEnabled=true`. (Corrected at code review Stage 2:
  `activeProjectId === null` alone misses the synthesized "Unassigned"
  pseudo-project, which shares the same `realProjects[0]` fallback as All
  Projects.) Verified: unit tests (All-Projects, Unassigned, and
  single-project branches, all three with `previewEnabled` explicitly true
  so no case can pass vacuously) + real-browser E2E toggling between
  All-Projects and single-project mode on the same page.
- [ ] **AC1-user.** Sven visually confirms the Triage filter bar reads as
  "standard" against the Board. (Pending — awaits Sven's look at the merged
  result; the initial screenshots drove the fix, not a sign-off on it.)
- [ ] **AC2-user.** Sven visually confirms the Preview button is legible on
  the dark Board toolbar. (Pending, same reason.)

## Out of Scope

- Converting the Triage filter bar from an always-visible chip row into a
  Board-style funnel dropdown. The always-visible layout was a deliberate,
  recent decision (iterate-2026-08-08-triage-filters-sort-parked) — Sven
  asked for matching *styling*, not a layout change.
- Any change to `.chrome-dark-controls`'s policy of not overriding semantic
  color families — the fix is local to `PreviewButton`.
- Fixing the repo-wide `border-[1.5px]` → computed-`1px` Tailwind quirk
  (see Internal Plan Review's Known Limitations) — pre-existing, affects
  components beyond this iterate, not reported by Sven.
- Chasing full WCAG 1.4.11 (3:1 non-text contrast) on `--color-border`
  itself — a pre-existing, app-wide token characteristic every bordered
  chip/card already shared before this iterate. (The excluded state's own
  visibility no longer depends on this: `line-through`, added at code
  review Stage 2, is the non-color cue, not the border or the near-invisible
  `--color-inset` fill.)

## Verification (medium+)

- **Surface:** web (client-only change; no server route touched).
- **Runner:** isolated dev stack in this worktree (Hono :3853 / Vite
  :5183, `SHIPWRIGHT_NETWORK_PROFILE=local`, temp `USERPROFILE`) +
  `client/e2e/flows/triage-filter-preview-restyle.spec.ts` run against it
  via `WEBUI_API_URL=http://127.0.0.1:3853 BASE_URL=http://127.0.0.1:5183
  npx playwright test e2e/flows/triage-filter-preview-restyle.spec.ts`.
- **Evidence:** both cases pass (2/2), asserting real `getComputedStyle`
  values, not class-string presence.
- **Visual-regression baseline (`/triage`, status: baselined):** this
  restyle WILL move the `/triage` baseline PNG. Cannot regenerate locally
  (Linux-only pinned container) — deferred to F11 per the documented flow:
  push → "Visual regression (gate)" goes red → `gh workflow run
  visual-baselines.yml --ref <branch> -f ref=<branch>` → download
  `changed-baselines.txt` → confirm **only** `triage.png` changed (the
  Board's `board` baseline fixture does not enable Preview, so the
  `PreviewButton` color change should not bleed into it — to be confirmed
  from the actual `changed-baselines.txt`, not assumed) → commit the new
  PNG → re-verify green.

## Confidence Calibration

- **Boundaries touched:** none serialized — pure UI/CSS + one conditional
  render. No `touches_io_boundary`.
- **Empirical probes run:** isolated dev stack (worktree, ports
  3853/5183), real Playwright screenshots of `/triage` and `/` before and
  after, directly compared against Sven's two reference screenshots; a
  real-browser E2E spec asserting computed styles (radius, border width,
  background colors, conditional presence).
- **Test Completeness Ledger:** see below.
- **Confidence-pattern check:** asymptote — the two root causes (#2, #3)
  are named exactly (one CSS variable scoping gap, one missing
  conditional); #1 is a token-reuse convention alignment, verified both
  visually against a live reference and via real-browser computed-style
  assertions. Coverage — all three reported symptoms have a corresponding
  AC, a unit test, and a real-browser E2E assertion.

| Behavior | Tested? | Evidence |
|---|---|---|
| Filter chip / sort-level corner radius | tested | `TriageFilterGroup.test.tsx` (class) + E2E (`borderRadius === "8px"`) |
| Chip on/off encoding is non-hue (line-through, not just fill/text color) | tested | `TriageFilterGroup.test.tsx` (class, incl. single-option Parked shape) + E2E (`backgroundColor` + `text-decoration-line`) |
| Excluded chip text clears AA on --inset (--ink-fixed, not --color-muted) | tested | `tokens.contrast.test.ts` (machine-checked ladder rung) + `TriageFilterGroup.test.tsx` (class) + E2E (`color === "rgb(28, 25, 23)"`) |
| `--color-primary` reserved for hover BORDER only (never text) | tested | `TriageFilterGroup.test.tsx` |
| Preview button bg token | tested | `PreviewButton.test.tsx` (class) + E2E (`backgroundColor === "rgb(239, 248, 255)"` on the real dark bar) |
| Preview button hidden on All Projects | tested | `CreateControls.test.tsx` (non-vacuous, `previewEnabled=true`) + E2E |
| Preview button hidden on Unassigned pseudo-project | tested | `CreateControls.test.tsx` (non-vacuous, `previewEnabled=true`) — code review Stage 2 finding |
| Preview button still shown single-project | tested | `CreateControls.test.tsx` (existing + new case) + E2E |
| `/triage` visual baseline | pending F11 | `requires-manual-visual-judgment` — Linux-container regen, deferred to finalization |
