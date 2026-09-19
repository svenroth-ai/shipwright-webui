# Mini-Plan: fix-wizard-plan-card-white-text

- **run_id:** iterate-2026-09-19-fix-wizard-plan-card-white-text

## 1. Files to modify

- `client/src/components/wizard/IntentWizard/NewPathPlanCard.tsx` (edit) —
  phases-list container: add `className="iw-card"` +
  `data-testid="wizard-plan-phases"`, drop redundant inline
  background/border/borderRadius/boxShadow.
- `client/src/styles/on-photo-legibility.test.ts` (edit) — add a regression
  test asserting the container's className includes an `.on-photo`
  reset-whitelisted class.

## 2. Work breakdown

1. Add `data-testid="wizard-plan-phases"` to the container (needed so the
   test can target it). Test: none yet (setup step).
2. Write the failing regression test in `on-photo-legibility.test.ts`,
   mirroring the existing `GradeResult` band-pill precedent. Test: confirm
   RED before the fix (temporarily swap the class to a non-whitelisted one
   and re-run).
3. Apply the fix — `className="iw-card"`, drop redundant inline style keys.
   Test: confirm the new test goes GREEN.
4. Run the full `on-photo-legibility.test.ts` suite + the wizard component
   test suite (`IntentWizard.test.tsx`, `wiring.test.tsx`,
   `launchFlow.test.tsx`) to confirm no regression on the sibling
   `envVarsRequired` block or any other on-photo surface.
5. Run `tsc --noEmit` + `oxlint` on both touched files, then the full client
   vitest suite (F0 fresh-verification gate).

## 3. Component hierarchy (UI)

`NewPathPlanCard` (wizard step) → phases-list container (`<div
className="iw-card">`) → per-phase row (`<div data-testid="wizard-phase-*">`)
→ phase name + phase description. No new components; existing tree, one
className change.

## 4. Data model changes

None.

## 5. Test strategy

- Unit: new assertion in `on-photo-legibility.test.ts` (class-membership
  fence — the same mechanical proxy this codebase already uses for this
  exact defect class, since jsdom cannot measure real rendered contrast).
- New E2E spec authored + run: `client/e2e/flows/wizard-plan-card-legibility.spec.ts`,
  a real-Chromium WCAG contrast check, ported from the sibling
  `grade-pill-legibility.spec.ts` (iterate-2026-08-26-grade-pill-contrast).
  **Correction (internal plan review caught this):** this section originally
  claimed real-browser contrast was `untestable`/`requires-manual-visual-judgment`
  "consistent with how GradeResult was verified" — that was false; GradeResult
  shipped exactly this kind of real-browser check, and the correct move is to
  do the same here, not to skip it citing a precedent that didn't skip it.
  The existing text-only E2E coverage
  (`iterate-2026-05-13-dynamic-stack-profiles.spec.ts`) remains unaffected.
- Full existing suites (wizard: 101 tests; client-wide: 4272 tests) re-run
  as regression coverage.

## 6. Alternative approach (rejected)

**Hardcode `color: "#1C1917"` inline on the phase-description `<div>`**
instead of joining the `.iw-card` reset whitelist. Rejected: it patches only
this one text node, leaves the container itself outside the reset system
(so the *next* inline-styled child added to this container reintroduces the
same class of bug — which is exactly how this defect was introduced
originally), and hardcodes a color value that would silently drift from the
shared on-photo dark/light tokens if they are ever retuned. `.iw-card` is
also a zero-risk, established, byte-identical match to a sibling block three
lines below in the same file.
