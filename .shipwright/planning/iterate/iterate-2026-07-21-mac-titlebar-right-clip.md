# Iterate — the title bar is cut on the right (macOS Edge + Safari)

- **Run ID:** `iterate-2026-07-21-mac-titlebar-right-clip`
- **Intent:** BUG (Path C — root cause before fix)
- **Complexity:** medium (`prior_source: history`, n=20; scope keyword said trivial)
- **Risk flags:** `touches_shared_infra` (app-shell layout — every route)
- **Spec Impact:** NONE (defect repair; no requirement changes)
- **Reported by:** Sven, 2026-07-21 — "On mac, the title bar is cut in Edge and in safari. right hand side, about 5mm."

## Symptom

The anthracite title bar stops short of the right edge of the window; the photo
backdrop shows through the resulting vertical strip. Reported on macOS in Edge
and Safari. A screenshot of the Task Board showed the strip beside the bar while
the photo below it ran to the edge.

## Root cause

`client/src/layouts/MainLayout.tsx` passed `[scrollbar-gutter:stable]` to
`<SceneBackdrop>`, which lands on `.scene-fore` — the shell scroll container.

`scrollbar-gutter: stable` permanently subtracts a scrollbar-wide strip from the
**right of the scrollport**, whether or not a scrollbar is showing. Both title
bars render INSIDE that scrollport:

```
.screen                     <- .scene-bg (photo) is absolute, inset:0  => FULL width
  .scene-bg  [photo]
  .scene-fore [scroller, gutter reserved]   <- content box is 15px narrower
     .page-head / .mc-top                   <- so the bar stops 15px short
```

The bar therefore ends 15px early and the full-width photo plate behind it shows
through — exactly the reported strip.

**Why 15px and not the 6px the app draws.** `index.css` sets
`scrollbar-width: thin` on `html, body`, and `scrollbar-width` **does not
inherit**. `.scene-fore` resolves `auto`, so the reserved gutter is the *native*
scrollbar width. (The `*::-webkit-scrollbar { width: 6px }` rule is a separate
legacy path.) PR #8 reserved a strip roughly three times wider than it assumed.

**Not macOS-specific.** Measured in headed Edge and headed Chromium on Windows:
15px on all six `.page-head` routes and on Mission Control's `.mc-top`. Sven
noticed it on the Mac; it shipped everywhere.

## Chesterton-Fence — why the gutter existed, and why removing it is safe now

PR #8 (`iterate 3.8c`, 2026-04-22) added it to stop a horizontal "spring" when
switching between routes: some routes overflowed the shell scroller and some did
not, so the content width changed with the scrollbar's presence. **That reason
was real** — and measured larger than the commit assumed (15px, not ~6px).
Removing the line alone therefore regresses PR #8, which was verified, not
assumed (see Probe 3 below).

It is obsolete because the app has since converged on bounding scroll *inside*
each route, below the title bar: Diagnostics, Inbox, Projects, Triage and Ship's
Log all use a `flex-1 overflow-y-auto` body, and the Board scrolls inside its
columns. **Settings was the last route still handing its overflow to the shell.**

So the fix is a pair: give Settings the same body, after which the shell scroller
never scrolls on any route — and then the gutter has nothing left to stabilise.

## Change

| File | Change |
|---|---|
| `client/src/layouts/MainLayout.tsx` | drop `[scrollbar-gutter:stable]`; record why it must not return |
| `client/src/pages/SettingsPage.tsx` | wrap the body in `flex-1 overflow-y-auto` (the Diagnostics pattern) |
| `client/src/pages/TaskBoardPage.tsx` | bound the LIST-view body the same way — found by code review, see Review log |
| `client/src/test/shell-scroll-invariant.test.ts` | NEW — CI ratchet on both halves, both drift directions |
| `client/e2e/flows/title-bar-full-bleed.spec.ts` | NEW — real-browser geometry gate on 7 routes, `@smoke`-tagged so CI runs it |

Baselines under `client/e2e/visual/__screenshots__/` are regenerated at F11 (the
"Visual regression (gate)" check is byte-exact and every bar moved 15px).

## Affected Boundaries

- App-shell layout (`.scene-fore` scrollport) — consumed by every route.
- Settings page body — now a bounded scroll region.
- Visual baselines: every title bar is 15px wider ⇒ `__screenshots__` regenerate.

## Confidence Calibration

- **Boundaries touched:** shell scrollport geometry (all routes); Settings body
  scroll ownership; visual baseline PNGs.

- **Empirical probes run:**
  - *Probe 1 (mechanism, headless Chromium + WebKit):* `.page-head` right edge
    1585 vs `.screen` 1600 ⇒ **gap 15px**; `.scene-fore` not overflowing ⇒ the
    gutter is reserved and empty; computed `scrollbar-width: auto` (not `thin`)
    ⇒ the 15px is the native metric. Setting `scrollbarGutter='auto'` ⇒ gap 0.
  - *Probe 2 (candidate fixes):* negative `margin-right` on the bar → gap 0 but
    `scrollWidth > clientWidth` ⇒ creates horizontal overflow ⇒ **rejected**.
    `scrollbar-width: thin` on the scroller → gap 10px ⇒ **rejected** (still cut).
    `scrollbar-width: none` → gap 0 but hides the page scrollbar ⇒ **rejected**.
  - *Probe 3 (falsification of "just remove it"):* **headless said removing the
    gutter was free; headed Chromium and real msedge disagreed.** On the one
    overflowing route (`/settings`) the classic scrollbar takes 15px, so the bar
    is cut again AND the content width springs 15px vs other routes. This is why
    the fix is a pair, not a one-liner. Headless was the wrong instrument.
  - *Probe 4 (the fix, headed msedge):* 6 routes × 3 viewports ⇒ **0 violations**;
    `headGap` 0 everywhere, `shellOverflows` false everywhere, shell client width
    constant 1376px ⇒ no spring.
  - *Probe 5 (Mission Control, headed msedge, differential):* `.mc-top` gap
    **15px pre-fix → 0px post-fix**. Closes the one surface the automated spec
    does not reach.
  - *Probe 6 (proof the E2E bites, differential):* the new spec run against the
    pre-fix production build ⇒ **7 failed** ("stops 15px short" on every route);
    against the post-fix build ⇒ **7 passed**.
  - *Probe 7 (proof the vitest ratchet bites, mutation):* re-adding the gutter ⇒
    1 failed; reverting Settings' bounded body ⇒ 1 failed; restored ⇒ 3 passed.
    Both mutations were verified to actually apply — the first attempt at the
    second mutation silently no-op'd and would have "passed" misleadingly.

- **Test Completeness Ledger:**

| # | Behavior introduced/changed | Disposition | Evidence |
|---|---|---|---|
| 1 | Shell scroller reserves no scrollbar gutter | `tested` | `shell-scroll-invariant.test.ts` "reserves NO scrollbar gutter"; mutation-verified |
| 2 | Every title-bar route bounds its own vertical scroll | `tested` | same file, registry-driven, both drift directions; mutation-verified |
| 3 | A new `<PageHead>` page cannot be added without registering its scroll owner | `tested` | same file, reverse-drift test |
| 4 | `.page-head` reaches the viewport right edge on all 6 routes | `tested` | `title-bar-full-bleed.spec.ts` (6 cases) — 7 passed post-fix / 7 failed pre-fix |
| 5 | No route overflows the shell scroller (no cross-route width spring) | `tested` | `title-bar-full-bleed.spec.ts` "shell scroller never scrolls" |
| 6 | Settings body scrolls internally, header stays put | `tested` | `title-bar-full-bleed.spec.ts` "Settings scrolls its own body…" — asserts the body actually overflows, scrolls it, and pins the header's rect. Added after external review; see Review log |
| 6b | The bar is fitted to the edge, not pushed past it | `tested` | same spec — two-sided gap assertion + `scrollWidth <= clientWidth` per route. Added after external review |
| 7 | `.mc-top` (Mission Control) reaches the right edge | `untestable` → `requires-interactive-tty` **NO** — see note | Probe 5, direct differential measurement (15px → 0px) |
| 8 | Baseline screenshots reflect the 15px-wider bar | `untestable` — `requires-manual-visual-judgment` | regenerated in the pinned Linux container; `changed-baselines.txt` reviewed against intended routes |

  **Note on row 7 — honest disposition.** This is testable in principle; it is
  not covered by the automated spec because reaching Mission Control needs a
  seeded task, and seeding writes into the real `sdk-sessions.json` unless the
  run is under an isolated USERPROFILE. It is verified by direct measurement
  (Probe 5) and its root cause is pinned unconditionally by behavior 1. Recorded
  as a known coverage boundary rather than dressed up as `untestable`.

- **Confidence-pattern check:**
  - *Asymptote (depth):* the causal chain is measured end to end — reserved
    gutter → narrowed scrollport → bar inset → photo visible — and the fix was
    verified by flipping exactly that property and re-measuring, in two engines,
    headed, plus a pre/post differential against a real prior build.
  - *Coverage (breadth):* 6 `.page-head` routes × 3 viewports, plus `.mc-top`.
    Uncovered: real macOS Safari/Edge (no Mac available — Playwright's WebKit on
    Windows does not reproduce macOS scrollbar metrics). Mitigation: the defect
    reproduced and was fixed on Windows at the same 15px, and the mechanism is
    platform-independent; Sven can confirm on the Mac after deploy.
  - *Integration composition:* `cross_component` not triggered — no framework
    machinery (merge/hooks/phase-validators/campaign drain) in the diff.

## Review log

**External LLM code review** (`external_review.py --mode code`, openrouter,
2 reviewers succeeded, not degraded) — three findings, all accepted:

1. *(medium, valid)* The geometry assertion was one-sided (`gap <= 0.5`), so a
   title bar pushed PAST the viewport edge would pass — precisely the negative-
   `margin-right` candidate that Probe 2 rejected for causing horizontal
   overflow. **Fixed:** the gap is now asserted from both sides, and every route
   additionally asserts `scrollWidth <= clientWidth`.
2. *(medium, valid)* AC4 ("Settings still scrolls, header stays put") was **not
   actually tested**. The shell assertions prove nothing hands scrolling upward;
   they do not prove Settings still scrolls at all, and the source-regex ratchet
   is satisfied by any stray `overflow-y-auto` token. The original ledger row
   claiming behavior 5 "covers it" was an overclaim. **Fixed:** added a
   Settings-specific browser test that asserts the body genuinely overflows,
   scrolls it, and pins the header's bounding rect.
3. *(low, known)* Visual baselines not yet regenerated — planned at F11 via
   `visual-baselines.yml` in the pinned Linux container.

Second reviewer separately flagged that `[&>*]:shrink-0` is **inert** on the new
wrapper, since that wrapper is a block-flow scroller and not a flex column —
DO-NOT #24 addresses self-scrolling column-flex containers. Correct. **Fixed:**
the utility was removed and the comment now says why it does not apply, rather
than citing a rule that does not bind here. The wrapper now matches the
Diagnostics body exactly.

- *Probe 8 (post-review differential):* the strengthened spec (8 cases) — **8
  failed** against the pre-fix production build, **8 passed** against the
  post-fix build.

**Internal code review** (one subagent, full-review over the worktree) — found a
**blocking correctness defect the author missed**, verified before accepting:

1. *(HIGH, confirmed by measurement)* **The Board's LIST view still handed its
   scroll to the shell.** `TaskBoardPage`'s list branch was a plain
   `.page-container` div — neither `flex-1` nor a scroll container — so with the
   gutter gone, `/?view=list` grew a real 15px shell scrollbar: the title bar was
   clipped again and the width sprang against every other route. Measured on the
   post-fix build before the second fix: `headGap 15`, `shellOverflows true`,
   overflow **19238px** at 1280x600 and 18938px at 1600x900; `clientW` 1041 vs
   1056 on kanban. The first fix moved the failure from `/settings` to
   `/?view=list` rather than removing it. List view is persisted in
   `localStorage` and deep-linkable, so it is a state users sit in.
   **Why the guards missed it:** the registry mapped one page to exactly ONE
   scroll owner, and for the Board it pointed at the kanban rail; the E2E only
   ever visited `/`. **Fixed:** the list body is now bounded, the registry maps a
   page to a LIST of owners, and `/?view=list` is an E2E route. Re-measured:
   `headGap 0`, `shellOverflows false`, `clientW` identical to kanban.
2. *(HIGH, partially accepted — see Residual risk)* `PipelineLaneCard` is an
   uncapped direct child, so a tall lane stack could push the root past 100%.
   Probed by injecting a synthetic lane: kanban never overflowed even at 520px;
   list view overflowed only at 520px on a 600px viewport (by 41px). Real but
   marginal, pre-existing, and strictly better than before (the bar used to be
   cut unconditionally). Recorded rather than restructured — see Residual risk.
3. *(MEDIUM, accepted)* The gutter ratchet scanned only `MainLayout.tsx`, but
   `.scene-fore` is DEFINED in `weather-deck.css` — the natural place to
   "re-stabilise" it — and `overflow-y: scroll` is the same defect in different
   spelling. **Fixed:** the scan covers `MainLayout.tsx`, `weather-deck.css` and
   `SceneBackdrop.tsx`, and matches both spellings. Mutation-verified.
4. *(MEDIUM, accepted)* `BOUNDS_OWN_SCROLL` was a whole-file substring match — it
   asserted "this file mentions an overflow utility somewhere". `TaskBoardColumns`
   has three, so deleting the load-bearing one left the test green. **Fixed:** the
   assertion now requires a SINGLE `className` carrying both `flex-1` and
   `overflow-y-*`, i.e. one element that both takes the height and scrolls.
5. *(MEDIUM, accepted)* The spec had no `@smoke` tag while the CI E2E gate runs
   `--grep @smoke`, so it would never have run again — the ledger's "tested"
   rows would have rested on one local run. **Fixed:** tagged `@smoke`.
6. *(MEDIUM, accepted)* The Settings scroll test depended on machine state: on an
   isolated CI stack with no projects the body would fit at 1280x600 and the test
   would fail on a correct build. **Fixed:** that test pins its own 1280x300
   viewport so the overflow is guaranteed by geometry, not by data.
7. *(LOW, accepted)* `code()` stripped block comments but not `//` — masking in
   the dangerous direction for the bounded-scroll rule. **Fixed:** both stripped.
8. *(LOW, not taken)* The root-cause narrative is duplicated across four files.
   The repo's convention is heavy inline rationale and each file is read
   independently; left as is, deliberately.

- *Probe 9 (post-review mutation sweep):* all four guard arms bite —
  gutter re-added to `MainLayout.tsx` → RED; to `weather-deck.css` → RED;
  Settings body unbounded → RED; **Board list body unbounded → RED**; restored →
  3 passed. The last two arms did not exist before this review.

## Acceptance Criteria

1. The title bar reaches the right edge of the window on every route — no strip
   of photo beside it. *(verified: 6 routes, gap 0)*
2. Mission Control's title bar likewise. *(verified: 15px → 0px)*
3. Switching between routes does not shift content sideways. *(verified: shell
   client width constant 1376px; no route overflows the shell)*
4. Settings still scrolls, with its header staying in place. *(verified)*
5. A future change cannot silently re-introduce either half. *(two ratchets,
   both mutation-verified)*

## Residual risk

- Real macOS was never exercised directly; the conclusion rests on the mechanism
  being platform-independent plus a same-magnitude Windows reproduction.
  **Sven should confirm on the Mac after deploy.**
- **An uncapped lane can still overflow the shell in list view.** Measured
  threshold: with a synthetic lane of 520px at a 1280x600 viewport, `/?view=list`
  overflows by 41px and the bar is inset again; at 260px it does not, and kanban
  never does at any tested height. `PipelineLaneCard` has no height cap while its
  neighbour `CampaignsLane` caps itself at `max-h-[40vh]`. This is a pre-existing
  property of an uncapped flex child, not something this change introduced, and
  the state is strictly better than before (the bar used to be cut on every route
  unconditionally). Capping the lane belongs in a Board-layout iterate, not in a
  title-bar bug fix — recorded here rather than silently absorbed.
- Only the six `.page-head` routes plus `/?view=list` are asserted. `/wizard`,
  `/tasks/:id` and `/projects/:id/log` were checked by hand (they do bound their
  own scroll) but are not in the automated route list; `IntentWizardPage` lives
  outside `pages/` so the reverse-drift ratchet cannot see it.
- Visual baselines must be regenerated in the pinned Linux container. Every
  baselined route legitimately changes (bars are 15px wider), so
  `changed-baselines.txt` will be long — it still needs reading for routes that
  should NOT have moved.
