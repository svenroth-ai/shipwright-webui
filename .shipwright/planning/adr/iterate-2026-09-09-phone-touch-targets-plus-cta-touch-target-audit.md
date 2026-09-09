# Phone touch-target audit + icon-only "+ New" reversal

## Context

A full audit of every phone (393px, Pixel 5) UI surface — Task Board
header/toolbar, Task Detail header, Inbox, mobile work mode, nav drawer,
Settings, terminal key bar — against WCAG 2.2 SC 2.5.8 (AA, 24×24), SC
2.5.5 (AAA, 44×44), and Apple HIG/Material (44×44pt/48×48dp, this repo's
adopted floor) found a family of interactive controls below the floor.
Separately, Sven asked for the phone "+ New" create-menu trigger to drop
its label/caret and become a bare, square `+`, reversing the labeled-pill
precedent `iterate-2026-08-13-mission-mobile-visual` shipped.

## Decision

Bumped every audit-failing control to the 44×44 floor using the repo's
existing `pointer-coarse:min-h-[44px]` / `h-11 w-11` idiom (never a new
`matchMedia` call or breakpoint constant — grep-verified). Shipped the
icon-only "+" in BOTH presentations (`ProjectCreatePhoneMenu.tsx`,
`CreateMenuSplitButton.tsx`'s primary half) via two new CSS classes in
`buttons.css` (`.btn-primary--icon-only`, `.bps-main--icon-only` /
`.bps-caret--touch`), each keeping a real accessible name via `aria-label`.

## Test reversal — old rule / new rule / who asked

**Old rule** (`iterate-2026-08-13-mission-mobile-visual`): the phone "+
New" trigger is a labeled pill, content-natural floor 88px wide
(icon+label+caret), asserted by `A20-mobile-visual-fixes.spec.ts` as
`createBox.width >= 88`.

**New rule** (this iterate, Sven's ask): the phone trigger is icon-only —
a bare, square 44×44 "+", no visible label, accessible name carried on
`aria-label` alone. The old width-88 assertion is now WRONG for a correct
implementation (a correct icon-only button is ~44px wide) — it was
REPLACED, not deleted, with: square (`|width-height| <= 2`), `>= 44×44`,
`toHaveText("")`, `toHaveAccessibleName(...)`, proven once per
presentation (cascade trigger + split-button primary half — both must
move together, per Sven's explicit "don't fix one and leave the other").

**Who asked:** Sven, after seeing the labeled pill next to
Filter/Density/ViewToggle at 393px — a bare `+` reads clearly at that
size and a true 44×44 AAA/HIG square is a stronger accessibility floor
than the wide label ever bought it. `--btn-min-w: 88px` itself is
UNCHANGED and still governs every labeled `.btn-primary` consumer
(Create Project, Ship's Log, …) — it also still happens to equal
`44px + 44px`, the split button's two icon-only halves summed.

`ViewToggle.tsx`'s `view-toggle-board` exactly-32px height assertion was
independently judged in the Step-1 audit (not blindly kept as a "license")
— it's now `>= 44` since ViewToggle's height genuinely was a floor
violation the audit found.

## Consequences

Every named surface now clears the 44×44 floor on a coarse pointer,
except a documented, width-budget exemption (below). The icon-only
reversal is width-gated (`useIsPhoneViewport()` / `≤767px`), unchanged at
desktop/tablet widths. The height-only `pointer-coarse:` bumps are
width-independent by design (same convention the terminal key bar already
uses) — they also fire on a touch tablet/touchscreen laptop at any width,
which is intentional (a coarse pointer needs a real touch target
regardless of screen size), not a scope violation.

## Documented exemption — Board toolbar row WIDTH

`ViewToggle` / `BoardStatusFilter` / `LeadTagFilter` (×2) /
`ClaimFilterToggle` / `DensityToggle` stay 32px **wide** on phone (height
bumped to 44px). The row packs up to 7 icon controls plus the create
button into 393px; bumping width too overflows it. WCAG AA 24×24 already
clears on the untouched axis. Verified empirically via a real
`scrollWidth <= clientWidth` Playwright assertion on the header, with all
fixes applied, at 393px. Same class of trade-off already accepted for the
old "+ New" 88px phone floor.

## Rationale

`pointer-coarse:` is the established, single-source touch-target idiom
(`SidebarNavItem.tsx`, `ModalShell.tsx`, `EditTaskModal.tsx`,
`ContinuePipelineModal.tsx` precedent) — extending it keeps one source of
truth for "is this a touch device" (`useIsCompactViewport.ts`'s three
queries) rather than inventing a second. Size fixes are a POINTER
question; layout fixes (icon-only) are a WIDTH question
(`useIsPhoneViewport()`) — the two axes were kept separate throughout.

## Rejected alternatives

1. Padding the "+ New" trigger back to 88px to keep the old assertion
   green — REJECTED, this is the exact anti-pattern the brief called out;
   88px was right for a labeled pill, wrong for a bare icon.
2. Bumping the Board-toolbar family to full 44×44 (both axes) — REJECTED,
   verified to overflow the 393px row; height-only + a documented width
   exemption is the honest trade-off.
3. A new dedicated `useIsTouchDevice()` hook or hand-typed
   `window.matchMedia('(pointer:coarse)')` calls — REJECTED, would create
   a second breakpoint source of truth; `useCoarsePointer()` already
   exists in `useIsCompactViewport.ts`, and the CSS-only
   `pointer-coarse:` Tailwind variant is the established idiom for a
   pure-geometry bump with no branching JSX.

## Review cascade

code-reviewer (Claude-only, no external LLM key available) found 4 real
audit gaps this pass had missed (`TriageSortLevel.tsx`,
`TriageFilterGroup.tsx`, `FolderTree.tsx`, `CopySnippet.tsx` — all
phone-reachable, all fixed) plus one documentation-completeness note
(addressed in the PR body). doubt-reviewer (Stage 3, adversarial) raised
4 doubts: (1) the "no desktop/tablet changes" framing overstated scope
for the width-independent `pointer-coarse:` family — corrected in
`ViewToggle.tsx`'s doc comment and this ADR; (2) a cosmetic, self-healing
JS/CSS resize race during a live viewport-width crossing of 767px —
acknowledged, no code change, advisory; (3) `CreateMenuSplitButton`'s
`primaryLabel = primary?.label ?? "New"` didn't guard an empty-string
label, which could produce a nameless icon-only button — fixed (`??` →
`||`) with a covering unit test; (4) zero unit-test coverage of the new
`iconOnly` behavior — fixed, added coverage to both components' test
files using the repo's existing `matchMedia`-mock pattern
(`TaskDetailHeader.phone.test.tsx`).

## Verification

typecheck clean; lint clean (pre-existing warnings only, none in touched
files); vitest 445/445 files, 4055/4055 tests green (one transient
worker-crash flake, confirmed clean on rerun); F0.5 E2E gate: 29/29 phone
E2E tests green against the real isolated-stack production build
(`A20-mobile-visual-fixes`, `90b-phone-new-task-touch-safety`,
`90-phone-responsive`, `90c-phone-up-band-guard`, `mobile-work-mode`,
`mobile-work-mode-mission`).
