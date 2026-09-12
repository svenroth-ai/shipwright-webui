# Mini-Plan: mobile-triage-form-layout

- **Run ID:** iterate-2026-09-12-mobile-triage-form-layout

## 1. Files to create/modify

| File | Change |
|---|---|
| `client/src/components/external/NewIssueModal/ModalShell.tsx` | edit — restructure `Dialog.Content` into a height-capped flex column (header/footer `shrink-0`, scroll body flex-fill) instead of the fragile `calc(100vh-280px)` budget |
| `client/src/components/external/NewIssueModal/ModalShell.test.tsx` | edit — update the body max-height assertion to match the new sizing strategy |
| `client/src/components/triage/TriageDetailModal.tsx` | edit — action-button row gets `flex-wrap` so it can never overflow past the dialog's left edge |
| `client/src/components/triage/TriageDetailModal.test.tsx` | edit — add a class-fence test for the wrap (jsdom has no layout engine, same rationale as ModalShell's existing fence) |
| `client/src/components/triage/PerProjectTriageSection.tsx` | edit — `max-md:` tightening of section/heading/list margins |
| `client/src/components/triage/DeferredTriageSection.tsx` | edit — same `max-md:` tightening |
| `client/src/components/triage/PerProjectTriageSection.test.tsx` | edit — assert the new phone margin classes are present (class fence) |
| `client/src/components/triage/DeferredTriageSection.test.tsx` | edit — same |
| `client/src/components/triage/TriageFilterSortBar.tsx` | edit — phone-only collapse behind a toggle, using `useIsPhoneViewport()`; unchanged at ≥768px |
| `client/src/components/triage/TriageFilterSortBar.test.tsx` | edit — toggle renders only on phone, defaults collapsed, expands on click, and non-phone always shows content |
| `client/e2e/flows/mobile-triage-form-layout.spec.ts` | new — real-browser Playwright spec at 375×667 proving AC1-AC4 |

## 2. Work breakdown

1. **ModalShell height fix (AC1).** Add `flex flex-col max-h-[80dvh]` to
   `Dialog.Content`'s existing className — **position is UNCHANGED**
   (`top-[10%]`/`-translate-x-1/2` stay exactly as-is; this mirrors
   `CampaignLaunchDialog.tsx`'s own established `top-[10%]` +
   `max-h-[80vh]` convention almost verbatim, just with `dvh` for the
   mobile-safe fix). *Revised after Internal Plan Review finding #2: the
   first draft also swapped to `top-1/2 -translate-y-1/2` centering,
   which would have silently changed desktop positioning for every
   ModalShell consumer with no stated rationale — dropped in favor of
   this narrower, position-preserving diff.* Give the header div
   `shrink-0`. Wrap the `<form>` in `flex min-h-0 flex-1 flex-col` so it
   participates in the column layout; wrap `<ModalScrollBody>` in a
   `min-h-0 flex-1` div (ModalScrollBody's own `className` prop stays
   restricted to `max-h-*`/`gap-*` per its invariant, so pass
   `max-h-full`); give the footer `shrink-0`. This removes the magic
   `280px` chrome-budget number and its `100vh`-on-mobile mismatch
   entirely — header/footer take their natural height, the body gets
   whatever remains, capped by the dialog's own `max-h-[80dvh]`. Test:
   update `ModalShell.test.tsx`'s existing max-height assertion; new
   Playwright cases (see step 5) scroll the body and assert the Launch
   button's bounding box is within the viewport, for both the plain
   New Task mode AND a `MoreOptionsDisclosure`-expanded mode (Internal
   Plan Review finding #5 — that nested `overflow-hidden` fragment is
   the exact class of thing that broke once before,
   iterate-2026-07-14-more-options-flex-clip, so the restructure must
   prove it doesn't regress that path even though the mechanism this
   iterate touches is orthogonal to that fragment's own guard).
2. **TriageDetailModal action-row wrap (AC2).** Add `flex-wrap` to the
   action-button row's className (`flex justify-end gap-2.5 mt-4 items-center`
   → `+ flex-wrap`). Mirrors the exact technique `ModalShell`'s own footer
   and `TriageFilterSortBar` already use for the same overflow class of
   bug. Test: a class-fence unit test (jsdom has no layout engine, same
   rationale as `ModalShell.test.tsx`'s existing fence — see that file's
   comment) plus a Playwright case asserting `triage-fix-now`'s bounding
   box has no negative `x`.
3. **Triage card/section spacing (AC3).** Tailwind v4 built-in `max-md:`
   variant (`<768px`, matches `PHONE_MEDIA_QUERY`) tightens
   `PerProjectTriageSection`'s `mb-8`→`+max-md:mb-4`,
   `mb-3`→`+max-md:mb-2`, the open-items wrapper `mb-4`→`+max-md:mb-2`; and
   `DeferredTriageSection`'s `mb-4`→`+max-md:mb-2`. No behavior change
   above 768px. Test: class-fence assertions in each component's existing
   test file.
4. **Filter bar phone collapse (AC4).** Add local `useState` (`phoneOpen`,
   default `false`) plus `useIsPhoneViewport()` (existing hook,
   `client/src/hooks/useIsCompactViewport.ts`) to `TriageFilterSortBar`.
   On phone, render a toggle button (`aria-expanded`, chevron icon —
   mirrors `MoreOptionsDisclosure`'s pattern) above the filter/sort
   content; content renders only when `!isPhone || phoneOpen`. At ≥768px
   `isPhone` is always `false` so the toggle never renders and content is
   always visible — behaviorally identical to today. Test: toggle absent
   + content visible at desktop width; toggle present + content hidden by
   default + content appears after click at phone width (mock
   `matchMedia`, same technique as existing phone-gated component tests
   e.g. `TaskDescriptionDisclosure.test.tsx`).
5. **E2E spec authoring + execution (AC1-AC4, F0.5).** One Playwright spec,
   `375×667` viewport, four test cases mirroring the four ACs above,
   executed against the dev stack before F6 per the medium+ "always
   author AND run" rule.

## 3. Component hierarchy (unaffected — no new components)

```
TriagePage
├── TriageFilterSortBar        (edit: phone collapse)
├── PerProjectTriageSection[]  (edit: margins)
│   ├── TriageItemCard[]       (unchanged)
│   ├── DeferredTriageSection  (edit: margins)
│   └── TriageDetailModal      (edit: action-row wrap)
└── NewIssueModal
    └── ModalShell             (edit: height/flex restructure)
```

## 4. Data model changes
None.

## External LLM Plan Review — integrated findings

Both glm (via openrouter, verdict `approve`) and codex/openai (verdict
`revise`) confirmed the core approach is sound and converged on the same
verification-completeness gaps. Triaged:

- **ModalShell has exactly ONE consumer file** (`NewIssueModal.tsx`,
  confirmed by grep — `EditTaskModal`/`ContinuePipelineModal`/
  `CampaignLaunchDialog` do not import it, they're independent Dialog
  implementations, matching the Out-of-Scope note). All 5 modes
  (new-task/plain/iterate/pipeline/generic) share the identical shell DOM
  structure — only `children` rendered inside `ModalScrollBody` differs,
  the footer is defined once in `ModalShell` itself. **fix** — this is now
  stated as a verified fact (not an assumption) here and in the spec; the
  Iterate/Pipeline `MoreOptionsDisclosure` E2E case (step 1) is the
  concrete regression proof both reviewers asked for.
- **AC2's Playwright case must check all 4 buttons, not just `triage-fix-now`.**
  **fix** — step 5 below now asserts all four action buttons' bounding
  boxes are fully within the dialog/viewport.
- **AC3 is unfalsifiable by class-fence alone.** **fix** — step 5 adds a
  real geometry measurement (distance from the open-items list's bottom to
  the Deferred section / next project heading, for a seeded 2-3-item
  project) alongside the existing class fences.
- **`useIsPhoneViewport()` flash-of-expanded-content on phone.** Verified
  in `useIsCompactViewport.ts`: the hook's `useState` lazy initializer
  reads `window.matchMedia(query).matches` synchronously during the first
  render (not in a `useEffect`), so there is no post-mount flash — this is
  the same hook already used by other phone-gated components without a
  reported flash. **disclose** — no change; step 5 keeps one E2E assertion
  that the filter bar renders collapsed on the FIRST paint at phone width
  to make this verified, not assumed.
- **`dvh` fallback for older browsers (Safari <15.4).** **decline** — a
  `max-h-[80vh] max-h-[80dvh]` fallback pair relies on cross-utility
  declaration ORDER in Tailwind's generated stylesheet, which is not
  guaranteed to match authoring order for two arbitrary-value classes on
  the same property (Tailwind v4's engine inserts each unique utility once,
  at its own first-encountered position, not per-callsite) — the fallback
  could silently invert depending on unrelated code elsewhere in the
  bundle. This app is a **local developer tool** (not a public product),
  so the realistic browser matrix is the operator's own modern phone
  Safari/Chrome; the fragility of a wrong-order fallback outweighs
  supporting a browser this project has no real users on.
- **pointer-coarse / wrapped-footer state for AC1.** Already covered
  without extra work: every E2E case runs with Playwright's default mobile
  viewport emulation (375×667, which sets `pointer: coarse` via device
  emulation), so the `pointer-coarse:min-h-[44px]` footer buttons and
  their wrap are exercised by every AC1 case already planned, not just a
  dedicated one.

## 5. Test strategy
- Vitest: update/add class-fence assertions in the five touched component
  test files (jsdom cannot render real layout — precedent already set by
  `ModalShell.test.tsx`'s `iterate-2026-07-14-more-options-flex-clip`
  fence and `modal-scroll-body-invariant.test.ts`).
- E2E (Playwright, real browser, 375×667): new spec, authored AND executed
  per the medium+ rule — the only way to actually prove AC1/AC2 (bounding
  boxes within viewport) since jsdom has no layout engine.
- No unit-level logic changes (no new hooks/reducers) beyond the
  `useState`/`useIsPhoneViewport()` wiring in step 4, which the toggle test
  covers directly.

## 6. Alternative approach (rejected)

**Alternative:** Fix `ModalShell`'s footer visibility by simply lowering
the `calc(100vh-280px)` budget number (e.g. `-360px`) to leave more slack,
and swap `vh`→`dvh` in place, without restructuring to flexbox.

**Rejected because:** a bigger fixed budget is still a magic number tuned
to today's footer content (2 buttons + hint, single line). The footer
already demonstrably wraps to 2 lines at phone widths with `pointer-coarse:
min-h-[44px]` buttons — a larger constant would still break the next time
the footer gains content (an error bar, a third button) or on an even
narrower device, reproducing the exact bug class this iterate exists to
close. The flex-column restructure removes the magic number entirely: the
scroll body's available height is *whatever the header and footer don't
use*, correct by construction for any header/footer height. This is the
architecture review question (Step 3.5 step 2a) too — see `## Architecture
Review` below once run.
