# Mobile Triage/task-form layout: flex height-chain fix + spacing/collapse

## Context

A German bug report named four mobile-viewport (<768px) defects in the
Command Center: (1) the New Task form's Launch button pushed almost
off-screen; (2) the same class of problem in the Triage detail panel; (3)
the Triage detail action row clipped past the dialog's left edge, making
"Fix now" nearly unclickable; (4) accumulated per-project section spacing
in the Triage list forcing excessive scrolling, plus a request to make the
filter/sort bar collapsible on phone. Full spec:
`.shipwright/planning/iterate/2026-09-12-mobile-triage-form-layout.md`.

## Decision

- `ModalShell.tsx`'s `Dialog.Content` gained `flex flex-col max-h-[80dvh]`
  (position unchanged, `top-[10%]` preserved) so the dialog is height-capped
  instead of unbounded; header/footer are `shrink-0`, and the `<form>` +
  body-slot wrapper are `min-h-0 flex-1` so they — not a magic pixel/vh
  budget — absorb whatever height the header/footer don't use.
  `ModalScrollBody`'s className narrowed from `max-h-[calc(100vh-280px)]`
  to `max-h-full`.
- **Real production bug found and fixed during this iterate, not
  hypothetical**: the body-slot wrapper div also needed `flex flex-col` on
  ITSELF (not just `min-h-0 flex-1`) for `max-h-full` to resolve on its
  child at all. A flex item's flexed main size is definite for measuring
  the item's own box, but a plain `display:block` item does not extend
  that definiteness to a percentage-sized descendant — only when the item
  is itself a flex/grid container does its content box become a valid
  resolution target. Without this, `max-h-full` silently computed to
  `none` and the body grew to its full, unbounded content height. Neither
  the pre-existing unit class-fence nor the two E2E tests originally
  written for the vh/dvh mechanism caught this; it surfaced only when a
  code-review-suggested non-vacuous forced-overflow E2E test (a
  deliberately shorter 375×480 viewport) needed real overflow to mean
  anything. Root-caused via `page.evaluate()` computed-style dumps across
  the DOM chain, confirmed with a minimal static HTML/CSS repro before
  applying the one-class fix.
- `TriageDetailModal.tsx`'s action-button row gained `flex-wrap` (was a
  non-wrapping flex row that clipped past the dialog edge with 4 buttons
  at 375px).
- `PerProjectTriageSection.tsx` / `DeferredTriageSection.tsx` gained
  `max-md:` (<768px) tightened margins on the section, heading, and
  open-items list, AND (added after external code review flagged the gap)
  `max-md:space-y-1` on the card-to-card gap itself — AC3 asked for less
  *scrolling*, not just tighter section boundaries.
- `TriageFilterSortBar.tsx` gained a phone-only collapse/expand toggle
  (`useIsPhoneViewport()`, collapsed by default, `aria-expanded`); desktop
  (≥768px) renders exactly as before, no toggle.

## Consequences

- One class-fence + one real-browser E2E test per AC (8 E2E cases total,
  split across two spec files to stay under the 300-line bloat gate); all
  green. Full existing client (452 files/4087 tests) + server (379
  files/4147 tests) suites pass with zero regressions; `tsc`/`oxlint`/the
  bloat anti-ratchet all clean.
- Three other ModalShell consumers (`EditTaskModal.tsx`,
  `ContinuePipelineModal.tsx`, `CampaignLaunchDialog.tsx`) plus
  `TriageDetailModal.tsx` itself (added to this list after Stage-2 code
  review independently re-confirmed it) share the same raw-`vh`
  dialog-sizing anti-pattern this iterate fixed in `ModalShell.tsx`, but
  were not reported and are deliberately left untouched — disclosed here
  and in the iterate spec's Out of Scope section rather than filed as a
  triage item, per this project's standing no-reflexive-triage-items
  convention.
- Two low-severity residuals from external code review, disclosed rather
  than fixed: (1) `top-[10%]` (small/ICB viewport) and `max-h-[80dvh]`
  (dynamic viewport) are computed against different viewport definitions,
  so on a real mobile browser with a tall, currently-hidden URL bar the
  combined box could in principle still exceed the visible viewport by a
  further margin on top of the primary vh/dvh gap below — no real device
  was available to verify a fix without risk of trading one unverified
  mobile assumption for another; (2) no active-filter-count indicator on
  the collapsed phone filter toggle — a real usability nicety, not an AC4
  violation, left out to avoid adding UI surface beyond what was asked.

## Rationale

The original bug report's specific mechanism — `100vh` sized against the
real mobile browser's large (chrome-hidden) viewport while a
fixed-position box's containing block is the small (chrome-visible) one —
is structurally unreproducible in headless Chromium: `setViewportSize` has
no real, resizable browser chrome, so `vh` and `dvh` always resolve
identically there. This was verified empirically (reverting the
`ModalShell.tsx` fix via `git stash` and re-running the two viewport-fixed
E2E cases left both green, proving they cannot falsify that mechanism).
Rather than claim false coverage, this is disclosed as a manual-only gap
in the iterate spec's Confidence Calibration, and a third, genuinely
discriminating E2E test (forced overflow via a shorter viewport) was added
to prove the flex-allocation chain itself — a different but real failure
mode — holds. That third test is what caught the actual `flex flex-col`
production bug above.

## Rejected

- Raising the footer buttons' `pointer-coarse:min-h-[44px]` magic number
  further, or hand-tuning per-consumer heights — rejected in favor of the
  general `flex flex-col max-h-[80dvh]` restructure, which fixes the class
  of bug (unbounded dialog height) rather than one instance of its
  symptom.
- Centering the dialog with `top-1/2` instead of preserving `top-[10%]` —
  an early draft did this and Internal Plan Review flagged it: it would
  have silently repositioned every ModalShell consumer's desktop layout
  with no stated rationale. Position preserved unchanged.
- Fixing the `top-[10%]`/`80dvh` unit mismatch (external review, low) by
  switching to `top-[10dvh]` — rejected without a real mobile device to
  verify against; see Consequences.
- Filling more New Task form fields to force overflow at the literal
  375×667 viewport AC1 names — tried; the description textarea is
  `resize-y` (user-draggable), not auto-growing, and the seeded fixture's
  minimal action catalog renders only a handful of advanced fields even
  fully expanded, so `scrollHeight === clientHeight` at that exact
  viewport regardless of field content. Documented as an unreachable
  precondition in this test harness rather than silently left untested;
  the shorter forced-overflow viewport (case 3) is the closest achievable
  substitute and is what found the real bug.

## Run

`run_id`: `iterate-2026-09-12-mobile-triage-form-layout`. Full spec, ACs,
Confidence Calibration, and Test Completeness Ledger:
`.shipwright/planning/iterate/2026-09-12-mobile-triage-form-layout.md`.
