# Iterate Spec: mobile-triage-form-layout

- **Run ID:** iterate-2026-09-12-mobile-triage-form-layout
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal
On phone viewports (<768px) the Triage tab and the task-creation form (New
Task / Fix-now, shared shell `ModalShell`) are unusable: the Launch button in
the task form is pushed almost entirely off-screen, the Triage detail
panel's action row ("Fix now" / Dismiss / Snooze / Promote) overflows past
the left edge of the dialog and is barely clickable, the per-project Triage
card list has enough accumulated section margin that a short list forces
excessive scrolling, and the filter/sort bar has no way to collapse to save
vertical space. Restore the phone-usable layout FR-01.38 already promises
for these surfaces.

## Acceptance Criteria
- [ ] AC1: At a 375×667 viewport, opening the "New Task" form (via Triage
      Fix-now or the board "+ New") and filling enough fields that the form
      body scrolls, the footer (Save to Backlog / Launch buttons) stays
      fully visible and clickable without the dialog extending past the
      viewport bottom.
- [ ] AC2: At a 375×667 viewport, opening a Triage item's detail panel, all
      four action buttons (Fix now / Dismiss / Snooze / Promote) are fully
      within the visible dialog bounds (no button clipped past the left
      edge) and each is clickable.
- [ ] AC3: At a 375×667 viewport, the Triage tab's per-project section
      margins and card-list spacing are tightened so a project with 2-3
      open items requires materially less scrolling than today to see its
      Deferred section / the next project.
- [ ] AC4: At a 375×667 viewport, the Triage filter/sort bar renders
      collapsed by default behind a toggle ("Filters & sort") and expands
      on tap; at ≥768px it renders exactly as before (always expanded, no
      toggle).

## Spec Impact
- **Classification:** none
- **NONE justification:** FR-01.38 ("Responsive tablet / phone layout")
  and FR-01.30 ("Triage tab & promote") already commit to a usable phone
  layout for these surfaces. This iterate restores that promise where four
  concrete surfaces regressed/never received phone-specific treatment; it
  does not change what the FRs describe.

## Out of Scope
- `EditTaskModal.tsx`, `ContinuePipelineModal.tsx`, `CampaignLaunchDialog.tsx`,
  and (added post-Stage-2-code-review — this iterate touches it for AC2 but
  only fixed the horizontal flex-wrap clipping, leaving its own
  `max-h-[85vh]`/`h-[85vh]` sizing untouched) `TriageDetailModal.tsx` share
  the same raw-`vh` dialog-sizing anti-pattern (confirmed by Repo Scout, and
  independently re-confirmed for TriageDetailModal.tsx by the Stage 2
  code-reviewer) but were not reported by the user as a vh/dvh bug and are
  not part of the triage/task-creation flow this bug report names — left
  untouched to keep this fix scoped to the reported surfaces. Per Internal
  Plan Review finding #3, this is a *confirmed* (not speculative) follow-up,
  but per this project's standing convention (no reflexive triage items —
  capture genuinely-deferred follow-ups in the ADR + a memory instead of a
  standing triage card) it is recorded here and in the iterate ADR (F3),
  not filed as a triage item.
- `.page-container`'s global 32px phone padding (shared by ~10 other pages)
  is a contributing factor to Triage card badge-row wrapping but is out of
  scope: tightening it globally risks visual regressions across Board /
  Settings / Diagnostics / Inbox / etc. for a fix reported only on Triage.
- Hiding/removing any triage-card metadata (id, priority/domain hint) to
  save vertical space — the report asks for less *spacing*, not less
  *information*.
- An active-filter-count badge on the collapsed phone filter toggle (e.g.
  "Filters & sort (2)") — external code review (glm) flagged that a phone
  user can't tell filters are narrowing the list while the bar is
  collapsed. Real usability gap, not an AC4 violation (AC4 only asks for
  collapsed-by-default + expand-on-tap, both of which hold); left
  undone here to avoid adding UI surface beyond what was asked (YAGNI) —
  disclosed rather than filed as a triage item, per this project's
  standing convention.
- Hardening `top-[10%]` + `max-h-[80dvh]` to share one CSS unit — external
  code review (glm) noted these two are computed against different
  viewport definitions (`%` against the small/ICB viewport, `dvh` against
  the dynamic one), so on a browser with a tall, currently-hidden URL bar
  the combined box could in principle exceed the visible viewport by a
  further ~10-70px on top of the already-disclosed vh/dvh gap above.
  `top-[10%]` was deliberately preserved unchanged (Internal Plan Review
  finding #2 — mirrors CampaignLaunchDialog's own `top-[10%]` convention
  and avoids silently repositioning every ModalShell consumer); changing
  its unit without a real mobile device to verify against risks trading one
  unverified mobile-viewport assumption for another. Left as a residual,
  disclosed here alongside the primary vh/dvh gap rather than guessed at.

## Design Notes
No `.shipwright/designs/` mockups exist for these surfaces (none needed —
no new component or token). Design Check Tier 2 (markdown):
- **Affected mockups:** none.
- **Design tokens applied:** none new — all existing (`--color-primary`,
  `--radius-button`, `--color-surface`, etc.) reused verbatim.
- **New vs modified components:** zero new components. Modified:
  `ModalShell` (layout only, same visual chrome), `TriageDetailModal`
  (action row gains wrap, same button styles), `PerProjectTriageSection` /
  `DeferredTriageSection` (margin values only, phone-scoped), `TriageFilterSortBar`
  (new phone-only toggle button, styled to match the existing
  `MoreOptionsDisclosure` header-bar convention: chevron icon, `aria-expanded`,
  text label — not a new visual language).
- **Deviations from visual guidelines:** none — the filter-bar toggle
  reuses an established disclosure pattern rather than inventing one.

## Affected Boundaries
n/a — no serialized format (JSON/env/YAML) touched. This is Tailwind
class + minimal React state changes.

## Confidence Calibration
- **Boundaries touched:** n/a — no serialized format, API, or storage boundary.
- **Empirical probes run:**
  - Real-browser Playwright at 375×667, split across
    `e2e/flows/mobile-triage-form-layout.spec.ts` (AC1, 3 cases) and
    `e2e/flows/mobile-triage-spacing-filters.spec.ts` (AC2-AC4, 5 cases) —
    the single original file crossed the 300-line bloat gate at 330 lines
    (new-file crossing, Stop-hook blocked) and was split along the natural
    AC1-vs-Triage-side seam with zero behavioral change (verified: 8/8
    still pass post-split). Default `chromium` project via
    `node e2e/isolated-stack.mjs`.
  - Isolated-CSS-cascade probe (bare HTML + the built `dist` stylesheet loaded in
    a real Chromium page) to distinguish a genuine CSS-specificity/ordering bug
    from a test-timing bug when AC3's phone test first failed — confirmed the
    `mb-8 max-md:mb-4` cascade resolves correctly (32px→16px) in isolation; the
    real failure was the E2E test racing `PerProjectTriageSection`'s `isLoading`
    branch, which renders the same `data-testid` with a bare `mb-8` (no
    `max-md:mb-4`) before the query resolves. Fixed by waiting on the
    `triage-open-items-*` testid (real content) instead of the section shell.
  - AC2's first E2E run also failed (`triage-snooze` "viewport ratio 0") because
    the test asserted all 4 action buttons visible simultaneously without
    scrolling, while `TriageDetailModal`'s content pane is (and always was)
    independently `overflow-y-auto` — that vertical scroll was never part of
    the reported bug (only horizontal left-edge clipping was). Fixed by
    `scrollIntoViewIfNeeded()` per button before measuring, matching the
    horizontal-containment assertion the AC is actually about.
  - AC1's original two cases were falsified (via a `git stash` revert of the
    `ModalShell.tsx` fix + rerun) to still pass — headless Chromium's fixed
    `setViewportSize` has no vh-vs-dvh distinction (no real browser chrome to
    hide/show), so the specific reported mechanism is structurally
    unreproducible in this harness. Kept as baseline/no-regression checks;
    added a third, genuinely discriminating test using a deliberately short
    375×480 viewport to force real content overflow. That third test **found
    a real, previously-shipped production bug**: `ModalShell.tsx`'s body-slot
    wrapper div needed `flex flex-col` added (was `min-h-0 flex-1` only) —
    a plain `display:block` flex item does not extend its own definite
    flexed height to a percentage-height descendant (`ModalScrollBody`'s
    `max-h-full`); only a flex/grid container does. Root-caused via
    `page.evaluate()` computed-style dumps across the DOM chain, then
    confirmed with a minimal standalone HTML/CSS repro before applying the
    one-class fix. Neither the unit-level class fence nor the two
    vh/dvh-focused E2E cases would ever have caught this — it surfaced only
    because the forced-overflow test needed a non-vacuous precondition.
  - Stage 2 code-reviewer re-run against the fixed diff (PASS, 3 low/info
    notes, all addressed): converted two remaining vacuous
    `className.toContain(...)` assertions in
    `PerProjectTriageSection.test.tsx` / `DeferredTriageSection.test.tsx` to
    `toHaveClass(...)`; added `TriageDetailModal.tsx` to the Out of Scope
    disclosure list below (it shares the raw-`vh` dialog-sizing anti-pattern
    with the three already-named modals, confirmed independently by this
    review even though AC2 only needed its horizontal flex-wrap fix); the
    third note (sibling E2E file missing from the review's stated scope) was
    a scope-list omission from the split above, not a defect — the file was
    read and verified directly by the reviewer.
- **Test Completeness Ledger:**

  | Behavior | Status | Evidence |
  |---|---|---|
  | AC1: Launch button stays within phone viewport (plain New Task form) | tested | `mobile-triage-form-layout.spec.ts` AC1 case 1 |
  | AC1: Launch button stays reachable with More Options expanded (fragile path) | tested | `mobile-triage-form-layout.spec.ts` AC1 case 2 |
  | AC1: flex-allocation chain holds under genuine content overflow (forced-overflow stress case) — caught the `flex flex-col` production bug | tested | `mobile-triage-form-layout.spec.ts` AC1 case 3 |
  | ModalShell dialog is a height-capped flex column, header/footer shrink-0, form + body-slot middle links + body all correctly bounded | tested | `ModalShell.layout.test.tsx` (full height-allocation chain, all links) |
  | AC2: all 4 Triage action buttons contained within dialog + viewport at 375px | tested | `mobile-triage-spacing-filters.spec.ts` AC2 |
  | TriageDetailModal action row carries `flex-wrap` | tested | `TriageDetailModal.layout.test.tsx` |
  | AC3: per-project section/heading/open-items margins tighten at <768px, unchanged ≥768px | tested | `mobile-triage-spacing-filters.spec.ts` AC3 (both viewports) + `PerProjectTriageSection.test.tsx` + `DeferredTriageSection.test.tsx` |
  | AC4: filter/sort bar collapsed by default on phone, expands on tap, no toggle on desktop | tested | `mobile-triage-spacing-filters.spec.ts` AC4 (both viewports) + `TriageFilterSortBar.test.tsx` |
  | `useIsPhoneViewport()` initializes synchronously (no expanded-then-collapse flash) | tested | source-read confirmation (`useIsCompactViewport.ts` `useState(() => matchMedia(...).matches)`) + AC4's "collapsed on first paint" E2E assertion (`aria-expanded="false"` checked immediately after `page.goto`, no wait) |
  | `pointer: coarse` CSS (footer touch-target sizing) exercised on a real mobile-emulated context | tested | `mobile-triage-form-layout.spec.ts` AC1 describe block, `test.use({ hasTouch: true, isMobile: true })` |
  | Full existing client test suite has no regressions | tested | `npx vitest run` — 452 files / 4087 tests, all passing; `npx tsc --noEmit` clean; `npx oxlint .` zero new warnings; `anti_ratchet_check.py` clean |

  One disclosed, deliberately-not-covered mechanism (not an `untestable` row
  in the strict sense — it is a real gap, not a behavior in scope): the
  original bug report's actual vh-vs-dvh mechanism cannot be exercised in
  this harness (headless Chromium has no real, resizable browser chrome) —
  see the empirical falsification above. The fix is structurally correct
  (`max-h-[80dvh]` + a genuinely bounded flex chain, both real-browser
  verified for the *overflow* symptom) but the exact mobile-toolbar
  interaction is a manual-verification gap, disclosed here rather than
  silently claimed as covered.
- **Confidence-pattern check:** Asymptote depth — every E2E failure surfaced
  during this iterate (the AC3 race, the AC2 scroll-design bug, and the
  AC1 non-falsifiability finding) was root-caused to a specific mechanism
  rather than patched by loosening an assertion, and one of those
  root-causings (the forced-overflow stress test) led directly to finding
  and fixing a real, previously-shipped production bug — the strongest
  possible evidence the test-writing process was not vacuous. Coverage
  breadth — all 4 ACs have both a class-fence unit test and a real-browser
  geometry test; the class fences now cover every link in the height chain,
  not just the two ends. Integration composition — n/a (`cross_component`
  flag not set; this is a same-component UI layout change, no
  cross-plugin/cross-package machinery touched).

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Core technical approach (ModalShell flex restructure, flex-wrap on the triage action row) is sound and was hand-verified against real flex/CSS mechanics. Three revise-level findings, none requiring re-architecture.
- **Findings:**
  - architecture/completeness, medium: the first draft's `top-1/2` centering swap silently changed desktop positioning for every ModalShell consumer with no stated rationale — fix: fixed, position now unchanged (`top-[10%]`), only `flex flex-col max-h-[80dvh]` added.
  - architecture/completeness, medium: 3 other modals (EditTaskModal/ContinuePipelineModal/CampaignLaunchDialog) share the same anti-pattern and are left untracked — fix: disclose, recorded here + ADR + memory per the project's no-reflexive-triage-items convention (declined to file a triage card).
  - completeness, medium: test strategy didn't explicitly cover the `MoreOptionsDisclosure`-expanded path (the exact fragile spot from iterate-2026-07-14-more-options-flex-clip) — fix: fixed, added to mini-plan step 1 + step 5's E2E cases.
  - architecture, low (Fix now/Dismiss/Snooze/Promote at h-10=40px, below the 44px AAA/HIG floor CLAUDE.md rule 26 established elsewhere): disclose, out of this AC's literal scope (AC2 only requires clickable, not touch-target-compliant) — noted for a future iterate, not fixed here.
  - architecture, low (`max-md:` is a new-to-repo Tailwind v4 idiom): disclose, no action — confirmed no custom breakpoint override exists, aligns with the existing `md:` usage already in `TriageDetailModal.tsx`.
- **Known limitations:** Fix now/Dismiss/Snooze/Promote buttons stay at 40px height (below the repo's stated 44px touch-target floor) — AC2 requires clickable, not touch-target-compliant; left for a future iterate.
- **Status:** 3 fixed, 2 disclosed

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-12-mobile-triage-form-layout/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — Tailwind class fixes + one phone-gated `useState` toggle reusing the existing `useIsPhoneViewport()` hook.
- **Findings:** existence/low (glm): the filter-bar collapse toggle is the only genuinely new stateful UI and is scoped correctly (phone-only, mirrors `MoreOptionsDisclosure`) — not a standing mechanism. No action.
- **Reconciliation:** Nothing to reconcile against the mini-plan's rejected alternative (Section 6) — both reviewers independently confirmed the flex restructure is the smallest correct fix, matching the plan's own rejection of the "just raise the magic-number budget" alternative.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `npx playwright test e2e/flows/mobile-triage-form-layout.spec.ts` (client/)
- **Evidence path:** `client/test-results/` + `shipwright_test_results.json.iterate_latest.surface_verification`
