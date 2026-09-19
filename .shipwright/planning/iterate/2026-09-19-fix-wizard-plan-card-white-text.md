# Iterate Spec: fix-wizard-plan-card-white-text

- **run_id:** iterate-2026-09-19-fix-wizard-plan-card-white-text
- **Intent:** BUG
- **Complexity:** medium (classifier: keyword match, confidence 0.7, no risk flags, cross_split: false)
- **Status:** draft

## Problem

Sven reported (screenshot) that the New-Project wizard's "Here's what I
understood." plan card (`NewPathPlanCard.tsx`) renders its per-phase
description text (under Project / Design / Plan / Build / Test / Changelog /
Deploy) invisible — white text on a white card.

## Root Cause (F-debug, four phases)

1. **Read Error** — no thrown error; a rendering/legibility defect. Observed:
   phase names visible, phase descriptions invisible. Expected: both visible
   with normal dark-on-white contrast, matching every other solid card in the
   app.
2. **Reproduce** — open the New-Project wizard, reach the "Here's what I
   understood." step (`wizard-plan-card`). 100% reproducible — static
   rendering, no timing/state dependency.
3. **Recent Changes** — not a regression from a recent commit; this is a
   latent defect in `NewPathPlanCard.tsx` since its introduction (A08/A09a).
   It surfaced now purely because the user looked closely at this screen.
4. **Component-Boundary Instrumentation** — traced the token chain:
   - `client/src/styles/on-photo.css` rule 1 (`.on-photo`) flips `--ink` to
     `#fff` for text riding bare on the scene photo.
   - Rule 2 resets `--ink` back to `#1C1917` (dark) — but **only** for an
     explicit class whitelist: `.card, .tcard, .orch-card, .table-wrap,
     .logentry, .promptbox, .recesspanel, .modal, .popover, .wz-opt,
     .wz-input, .wz-outline, .iw-card, .sheet, .instr, .mc-hero, .termbig,
     .badge, .pill, .record, .artifact, .pane, .mc-verdict, .mc-tabs, .mc-op,
     .flightplan, .glass-card, .ft-card, .compact-tab-surface`.
   - The phases-list container in `NewPathPlanCard.tsx` (~line 51) is a bare
     inline-styled `<div>` with **no class** — not in that whitelist. So
     `--ink` stays `#fff` while the div's own inline `background: var(--card)`
     resolves white → white-on-white text.
   - This is the exact same mechanism as a prior fix in a sibling wizard
     screen: `iterate-2026-08-26-grade-pill-contrast` (GradeResult.tsx's band
     pill), which the codebase already carries a regression test for
     (`on-photo-legibility.test.ts`).

**Root-cause statement:** the phase-list container never joins the
`.on-photo` solid-surface reset's class whitelist, so `--ink` stays flipped
white from the bare-photo rule while the container's own background is
opaque white — an ordinary reset-membership gap, not a color-value bug.

## Fix

Give the container `className="iw-card"` — the exact class its sibling
`envVarsRequired` block a few lines below already uses for byte-identical
background/border/radius/shadow inline styles
(`intent-wizard-panels.css:172-177`). Drop the now-redundant inline
`background`/`border`/`borderRadius`/`boxShadow` (keep `maxWidth`/`padding`,
which `.iw-card` doesn't set). Add `data-testid="wizard-plan-phases"` so the
fix is machine-checkable.

**Rejected alternative:** hardcode `color: "#1C1917"` inline on the
description `<div>`. Rejected — it would fix this one instance but leaves the
underlying reset-whitelist gap open for the next inline-styled surface added
to this file (exactly how this bug was introduced the first time), and drifts
from the shared on-photo token system the moment its color values change.

## Failing test (written first, confirmed red before the fix, green after)

`client/src/styles/on-photo-legibility.test.ts` — new `describe` block
mirroring the existing GradeResult precedent: asserts the
`wizard-plan-phases` container's className includes one of the `.on-photo`
rule-2 reset selectors. Confirmed RED with the container reverted to a
non-whitelisted class (`wz-left`), confirmed GREEN with `iw-card` restored.

## Spec Impact

**NONE** — this restores the plan card's already-intended appearance (dark
text on a white card, matching every sibling surface); no spec/FR describes
"white text on the plan card" as intended behavior.

## Affected Boundaries

CSS/visual token application only. No `touches_io_boundary`, no API/data
change, no cross_split. Client-only (`client/src/components/wizard/...`,
`client/src/styles/on-photo-legibility.test.ts`).

## Verification (medium+)

- **AC-1-agent (mandatory):** `client/src/styles/on-photo-legibility.test.ts`
  — `wizard-plan-phases container carries a class the .on-photo
  solid-surface reset targets` passes; confirmed it fails without the fix.
- **AC-2-agent (mandatory):** `client/e2e/flows/wizard-plan-card-legibility.spec.ts`
  — real-Chromium WCAG contrast check on the actual rendered
  `wizard-phase-Build` description against its `wizard-plan-phases`
  container background; >= 4.5:1.
- **AC-1-user (optional):** Sven visually re-checks the New-Project wizard's
  plan-card step and confirms the phase descriptions **and** the newly
  visible row separators (previously invisible under the same bug — see
  "Visual side-effect" below) look right.
- **Surface:** `web` (React component + CSS token contract).
- **Runner:** `npx vitest run src/styles/on-photo-legibility.test.ts` from
  `client/` (unit) + `npx playwright test wizard-plan-card-legibility.spec.ts`
  (E2E, via `client/e2e/isolated-stack.mjs`).
- **Evidence:** unit — 15/15 on-photo-legibility assertions passed
  (13 pre-existing + 2 new); full client suite re-run after the fix — 471
  files / 4273 tests passed; `npx tsc --noEmit` and `npx oxlint` clean on
  all touched files. E2E — `wizard-plan-card-legibility.spec.ts` run via
  `client/e2e/isolated-stack.mjs`: **1 passed** against the real fix,
  confirmed **RED** (contrast ratio 1.00:1, assertion failure) against the
  true original bug shape (container reverted to the exact pre-fix inline
  `background: var(--card)` / `border: var(--line-card)` / `borderRadius: 16`
  / `boxShadow: var(--sh-card)`, no `.iw-card`), then **GREEN** again with
  the fix restored. Locator hardened per external-code-review finding: reads
  `wizard-phase-desc-Build` (a dedicated testid added to the description
  element) instead of a positional child index.

### Visual side-effect (internal plan review finding, addressed)

Each phase row draws `borderTop: 1px solid var(--line)`. Pre-fix, `--line`
was rule 1's flipped near-white value — invisible on the white card, same as
the text bug. Post-fix, rule 2 resets `--line` to a visible light gray, so
row separators become visible for the first time — including, if left
unhandled, a stray-looking line directly under the card's own top padding
above the *first* row. Fixed in the same diff: the first row's `borderTop`
is suppressed (`idx === 0 ? undefined : "1px solid var(--line)"`), matching
the conventional "dividers between items, not above the first" pattern.

### Disclosed: dimmed "Deploy" row contrast (code-review finding, pre-existing, out of scope)

The "Just on my machine" path renders the "Deploy" row with `skipped: true`
→ `opacity: 0.55`, which existed before this diff and is unrelated to the
white-on-white bug (it deliberately de-emphasizes a step that does not
apply). Post-fix, that row is legible for the first time too — measured
~3.9:1 contrast (`#1C1917` at 55% opacity over `var(--card)` = `#FFFFFF`),
below the 4.5:1 AA floor the new E2E asserts for the other (undimmed) rows.
This is an accepted, pre-existing de-emphasis choice, not part of the
reported defect (which was full invisibility, ~1:1) — not fixed in this
run. If Sven wants dimmed rows to also clear AA, that is a separate,
deliberate design decision for a future iterate, not a root-cause
consequence of this bug fix.

### AC-2-agent CI scope (code-review finding, addressed by disclosure)

`wizard-plan-card-legibility.spec.ts` is not tagged `@smoke`, so — like its
precedent `grade-pill-legibility.spec.ts` — it does not run in the CI-gated
subset (`.github/scripts/e2e-stack.sh` greps `@smoke`). AC-2-agent is
therefore a one-shot local proof recorded in this run, not a standing CI
guard; the standing automated guard against regression is the unit
class-membership fence (which cannot catch a future CSS-specificity
regression — external finding 5, already disclosed above). Consistent with
the existing project posture for this test family; not changed here to
avoid an unrelated CI-tagging-policy decision inside a bug-fix iterate.

### No visual baseline covers this screen

`client/e2e/visual/05-wizard.spec.ts` baselines `/wizard`, `/wizard/new`
(step 1 only — the brief-input heading), `/wizard/adopt`, and `wizard-grade`.
None reaches wizard step 5 ("Here's what I understood."), so the plan card
appears in no visual baseline and this fix's changes (new class, new row
separators) shift no baseline. Recorded here per internal-review finding so
a future reviewer does not have to re-derive it.

## Internal Code Review Cascade (spec-reviewer → code-reviewer → doubt-reviewer)

- **Stage 1 (spec-reviewer):** PASS. Every requirement in the iterate spec +
  mini-plan verified present, faithful, in-scope.
- **Stage 2 (code-reviewer):** PASS, 4 low-severity findings, all addressed:
  1. Inline-override fence regex missed `backgroundColor`/`backgroundImage`.
     **Fixed** — widened to `/background(Color|Image)?\s*:/i`.
  2. The dimmed "Deploy" row (`opacity: 0.55`, pre-existing) measures ~3.9:1
     post-fix, below the 4.5:1 AA floor the E2E asserts for undimmed rows.
     **Disclosed** — pre-existing de-emphasis choice, unrelated to the
     reported (fully invisible, ~1:1) defect; recorded above.
  3. `contrastRatio` was a third verbatim copy (`tokens.contrast.test.ts`,
     `grade-pill-legibility.spec.ts`, this new file). **Fixed** — extracted
     to `client/e2e/helpers/contrast.ts`; the pre-existing grade-pill copy
     was left as-is (advisory, not required — kept this diff's blast radius
     to what it touches).
  4. The new E2E carries no `@smoke` tag, so it doesn't run in CI.
     **Disclosed** — same posture as its precedent; recorded above.
- **Stage 3 (doubt-reviewer):** not_applicable — diff touches no migrations,
  async/concurrency, cross-plugin imports, or irreversible ops (conditional
  trigger per `iteration-reviews.md` does not fire).

## External Code Review (Branch A, over the full diff)

- **Verdicts:** glm=approve · openai=approve.
- **Findings (all low severity):**
  1. glm — description locator used a positional child index
     (`phase.locator("> div").nth(1)`), fragile to structural changes.
     **Fixed** — added `data-testid="wizard-phase-desc-${ph.name}"` to the
     description element and locate by that instead.
  2. glm — `contrastRatio`'s RGB parser ignores the alpha channel; a
     translucent background would compute against black. **Disclosed** —
     shared idiom with the pre-existing `grade-pill-legibility.spec.ts` and
     `tokens.contrast.test.ts`; the container background is opaque today
     (`.iw-card` paints a solid `var(--card)`); fixing the shared helper is
     out of scope for this bug fix.
  3. glm — the spec's Evidence section still had a placeholder
     ("see result appended below once run") uncommitted. **Fixed** — actual
     E2E run result appended above.
- Both reviewers independently confirmed: the fix matches the spec exactly,
  the new unit test reads the real whitelist from `on-photo.css` rather than
  hardcoding it, and the E2E spec correctly avoids the transparent-background
  trap by reading `color`/`backgroundColor` from different elements.

## Confidence Calibration

- **Boundaries touched:** CSS custom-property token resolution under
  `.on-photo` scrim scoping; a single React component's className. No I/O
  boundary.
- **Empirical probes run:** (1) reverted the fix locally, re-ran the new
  test — RED, confirming the test actually pins the mechanism, not a
  tautology. (2) restored the fix, re-ran — GREEN. (3) ran the full
  `on-photo-legibility.test.ts` suite (14 tests) — no other surface
  regressed. (4) full client vitest suite (4272 tests) — all green.
  (5) `tsc --noEmit` + `oxlint` on both touched files — clean.
- **Test Completeness Ledger:**

  | Behavior | Status | Evidence |
  |---|---|---|
  | Phase-list container carries a `.on-photo` reset-whitelisted class | tested | `on-photo-legibility.test.ts` new case, red→green demonstrated |
  | Container sets no inline `background`/`boxShadow` that could silently re-shadow the class fix | tested | `on-photo-legibility.test.ts` second new case (internal + external review finding) |
  | No other `.iw-card` consumer in the file regressed (envVarsRequired block) | tested | pre-existing wizard test suite (101 tests) green, unchanged assertions on `wizard-plan-envvars` |
  | Real-browser rendered contrast (actual computed-style legibility) | tested | `client/e2e/flows/wizard-plan-card-legibility.spec.ts` — WCAG contrast math on real Chromium `getComputedStyle`, same pattern as `grade-pill-legibility.spec.ts`. **Correction:** the mini-plan originally mis-cited that precedent as having relied on the same "untestable" closure this run first proposed — it did not; it shipped a real-browser check, caught by the internal plan review (opus-plan-reviewer), and this run now does too |

  **Note (internal plan review, high-severity finding, addressed):** a naive
  port of `grade-pill-legibility.spec.ts` would have been a green no-op here —
  the description element inherits its background rather than painting its
  own, so reading `backgroundColor` off it returns transparent and the
  contrast math would pass even with the bug fully present. The new spec
  reads `color` from the description element and `backgroundColor` from its
  `wizard-plan-phases` ancestor instead.

- **Confidence-pattern check:** asymptote — traced the defect to a single,
  named mechanism (reset-class whitelist membership), not a guess; the fix
  is the minimal change that closes that mechanism. Coverage breadth — the
  sibling `envVarsRequired` block in the same file was checked and is
  already correctly whitelisted (`iw-card pad`), so this fix does not need
  to touch it; no other bare inline-styled solid surface exists in this
  component.

## Internal Plan Review (opus-plan-reviewer)

- **Ran:** yes
- **Severity:** medium (one high-severity finding, addressed)
- **Summary:** diagnosis and fix verified correct against source; gaps were
  in verification depth and guard scope, not the change itself.
- **Findings:**
  1. **[high, completeness] fix** — mini-plan mis-cited the GradeResult
     precedent as having relied on "untestable/manual visual judgment"; it
     actually shipped a real-browser Playwright contrast check. Authored +
     ran `client/e2e/flows/wizard-plan-card-legibility.spec.ts`; corrected
     the Test Completeness Ledger and mini-plan citation.
  2. **[medium, completeness] fix** — a naive port of that precedent would
     read a transparent `backgroundColor` off the description element itself
     (the container paints the background, not the description div) and
     always pass. The new spec reads `color` from the description and
     `backgroundColor` from the `wizard-plan-phases` container.
  3. **[medium, architecture] disclose** — the class-membership fence
     protects only this one testid; the same defect class (bare
     inline-styled element outside the `.on-photo` reset whitelist) has now
     recurred three times in this directory (ReadinessGate 2026-08-22,
     GradeResult 2026-08-26, this run). CLAUDE.md DO-NOT rule 26 records
     this project's own precedent for replacing per-component fixes with a
     directory-wide source scan after a third repeat. **Declined for this
     run's scope**: a correct scanner needs to reason about CSS
     custom-property inheritance through JSX ancestors (the reviewer's own
     verification found `GradeDimensionRow.tsx:92-100` — an unclassed inline
     `background: var(--inset)` block — is safe only because it inherits an
     already-reset `--body` from its `.iw-card pad` ancestor in
     `GradeResult.tsx`), which a regex/text scan cannot generally determine
     without risking false positives that block unrelated future PRs.
     Building that scanner correctly is a separate, appropriately-scoped
     iterate, not part of fixing this one instance.
  4. **[medium, completeness] fix** — the fix makes `--line` visible on the
     phase-list rows for the first time (previously hidden by the same bug),
     which surfaces a new-looking stray top separator above the first row.
     Addressed: first row's `borderTop` suppressed; recorded under
     "Visual side-effect" in Verification above.
  5. **[low, completeness] fix** — no stated visual-baseline impact
     analysis. Recorded under "No visual baseline covers this screen" above
     (verified: none does).
  6. **[low, architecture] fix** — the original regression-test regex
     required `className` immediately before `data-testid`, failing closed
     but with a misleading message on attribute reordering. Rewritten to
     match the whole opening tag first, then extract attributes from it
     (order-independent).
- **Known limitations:** finding 3 (directory-wide reset-whitelist scanner)
  remains open — same disposition as above, not filed as a separate triage
  item per this project's "don't reflexively create triage items"
  convention; noted here so it is discoverable if a fourth instance occurs.
- **Status:** 5 fixed, 1 disclosed

## External LLM Review (Branch A — `check-external-review-keys.py` → available)

- **Verdicts:** glm=approve · openai=approve (`--driver claude`).
- **Findings (all low severity, all addressed or disclosed):**
  1. glm — the class-membership fence alone doesn't stop a future inline
     `background`/`boxShadow` override from reintroducing white-on-white
     while staying green. **Fixed** — added a second test asserting no
     inline `background`/`boxShadow` on the container
     (`on-photo-legibility.test.ts`).
  2. glm — verify `.iw-card` carries no side-effect declarations beyond
     background/border/radius/shadow. **Verified** — grepped every
     `.iw-card` rule in the codebase (`on-photo.css` rule 2 + the two
     declarations in `intent-wizard-panels.css`); no hover/margin/other
     declarations exist.
  3. glm — make the optional AC-1-user (Sven's visual re-check) mandatory
     rather than optional. **Declined** — the iterate skill's own Two-ACs
     contract (`iteration-planning.md`) defines AC-N-user as never gating
     finalization by design; overriding that per-run would be
     inconsistent with the skill's own structure. Disclosed instead: the
     F12 run summary will explicitly ask Sven to eyeball the fixed screen.
  4. glm — verify the dropped inline `padding` still matches pre-fix
     rendering (sibling block uses `iw-card pad`, implying `.iw-card` alone
     sets no padding of its own). **Verified** — `.iw-card` (no `.pad`)
     sets no padding; the fix keeps the original inline `padding: "8px
     18px"`, so rendered spacing is unchanged.
  5. openai — the test verifies reset-whitelist membership, not computed
     contrast; a future CSS specificity change could still break legibility
     while `iw-card` stays present. **Disclosed** — already recorded in the
     Confidence Calibration ledger above as `untestable` /
     `requires-manual-visual-judgment`; this is the same mechanical-proxy
     limitation the codebase already accepts for the identical
     `GradeResult` precedent.

## Architecture Review

- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-19-fix-wizard-plan-card-white-text/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed — join the
  existing `.iw-card` / `.on-photo` reset machinery; the hardcoded-inline-color
  alternative was explicitly called out as smaller in lines but worse in
  kind (bypasses the token system, reopens the same trap).
- **Findings:** one low-severity proportionality note (glm) that the new
  regression test itself is the only standing-mechanism-adjacent artifact
  here — accepted as-is; a class-membership regression test is exactly the
  established pattern this codebase already uses for this defect class.
- **Reconciliation:** no rejected alternative needed re-opening; both
  reviewers independently agreed the mini-plan's proposed fix (not the
  brief's alternative) is the smallest correct change.
