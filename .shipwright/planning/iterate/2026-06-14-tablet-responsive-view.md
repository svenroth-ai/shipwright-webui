# Iterate Spec — Tablet Responsive View

- **run_id:** `iterate-2026-06-14-tablet-responsive-view`
- **Intent:** FEATURE
- **Complexity:** medium
- **Spec Impact:** ADD (new responsive behavior; desktop layout unchanged)
- **Date:** 2026-06-14
- **Phasing:** This is iterate **1 of 2** in a user-agreed device-phased rollout.
  Iterate 1 = **Tablet** (this spec, ~768–1023px). Iterate 2 (follow-up) =
  **Phone** (≤767px), which reuses the breakpoint foundation and the compact
  layout primitives built here, and is where "fully-interactive terminal on a
  narrow viewport" gets its dedicated soft-keyboard work.

## Problem

The WebUI is built width-unaware below 1024px. Only 2 of 221 components use
responsive prefixes; the sidebar is the sole adaptive surface (collapses to a
60px rail, but only below **768px**). Consequences on a tablet (iPad-portrait
~820px, iPad-landscape ~1024px):

1. At 768–1023px the sidebar stays at its full **200px**, eating content width.
2. The Task Board (3 × 360px columns + 40px gutters ≈ 1200px) overflows.
3. The Task Detail 3-pane (`react-resizable-panels`, assumes ≥~1280px) is
   unusably cramped — three resizable columns in <1024px.
4. Header control rows, tables, and a modal (`ConfirmDeleteDialog`, no
   `max-w` clamp) overflow horizontally.

## Goal

Make the WebUI genuinely usable on tablets (768–1023px) **without changing the
≥1024px desktop layout**, and lay the reusable breakpoint + compact-layout
foundation that the Phone iterate will build on.

## Breakpoint contract (foundation)

Tailwind 4 default breakpoints (no config file; CSS-first). This iterate
formalises three bands:

| Band | Range | Layout |
|---|---|---|
| **Desktop** | ≥ `lg` (1024px) | Current full layout — **unchanged** |
| **Tablet** | `md`–`lg` (768–1023px) | Compact: sidebar rail, board swipe, tabbed detail |
| **Phone** | < `md` (<768px) | **Reserved for iterate 2**; must not regress |

The single JS source of truth for "compact" (tablet **or** phone) is a new
`useIsCompactViewport()` hook wrapping `matchMedia('(max-width: 1023px)')`.
Components that need the band in JS consume the hook; everything else uses
Tailwind `lg:` prefixes (default-mobile, `lg:`-restores-desktop).

## Acceptance Criteria

- **AC-1 — Breakpoint foundation.** A `useIsCompactViewport()` hook exists
  (matchMedia `(max-width: 1023px)`, SSR-safe, change-listener) as the single
  JS SSoT for the compact band. The board scroll-snap track is composed from
  **Tailwind built-in utilities** (`snap-x snap-mandatory scroll-pl-6 snap-start`,
  `lg:`-reset on desktop) applied inline — no custom `index.css` rule was needed
  (YAGNI; the phone iterate reuses the hook + these Tailwind utilities, not a
  named CSS class). Desktop (≥1024px) renders byte-identical class output to
  today for the touched surfaces.
- **AC-2 — App shell + sidebar.** At ≤1023px the sidebar defaults to the 60px
  icon rail (threshold raised from 768→1023) so tablet content gets full width;
  it remains user-expandable. At ≥1024px the sidebar still defaults expanded.
- **AC-3 — Task Board (board view, list view, campaigns lane).** At tablet width:
  - **Board view:** the header cluster (project dropdown + view toggle + create
    controls) wraps without horizontal page overflow; the columns row is
    touch-swipeable with scroll-snap and starts flush at the first column (no
    `justify-between` gap artefact while scrolling).
  - **List view** (`TaskList`): secondary columns are `lg:`-gated (`md:table-cell`
    → `lg:table-cell`, equal-length net-zero swap) so they hide below 1024px and
    the essential columns (name · status · actions) fit — no wrapper-overflow
    change (that is not a safe net-zero on the 534-LOC file, per plan review H3).
  - **Campaigns lane** (`CampaignsLane` / `CampaignLaneCard`): campaign cards,
    progress bar, ordered step rows, and the Launch (Cx)/action button row stay
    inside the card width at tablet — action rows wrap, long titles/step labels
    truncate, no horizontal overflow.
- **AC-4 — Task Detail.** At ≤1023px the task-detail panes present as a **tabbed
  compact layout — Files · Session · Viewer** — so each surface gets full width.
  "Session" is the existing `center` node verbatim (it keeps its own inner
  Transcript/Terminal Radix tabs). **The `PanelGroup` is NEVER swapped for a
  different component type at the `center` position** — the same persistent tree
  stays mounted and compact mode is driven by imperative panel-sizing (active
  tab → ~100%, others collapse to 0 with `minSize:0`) + `forceMount`-style CSS
  hide + hidden resize handles. The embedded terminal therefore **never
  unmounts across a breakpoint crossing** (rotation/resize) — WS attach +
  scrollback survive (CLAUDE.md rule 21; avoids the lost-pending-turn footgun).
  Compact-vs-desktop is decided solely by `useIsCompactViewport()` (viewport
  `max-width:1023px`), the single SSoT. At ≥1024px the resizable 3-pane renders
  byte-identically to today. `TaskDetailPage.tsx` (676, **net-zero**) is untouched.
- **AC-5 — Secondary surfaces hardening.** Projects/Settings/Triage/Inbox have
  no horizontal page overflow at tablet width; the Projects table hides
  non-essential columns (`lg:`-gated). Modals are **out of real tablet scope**
  (all ≤560px wide → already fit ≥768px; clamping is an iterate-2/phone concern,
  plan review M3) — the one cheap exception is adding `max-w-[95vw]` to
  `ConfirmDeleteDialog` (76 LOC, free) as harmless defense that also helps
  iterate 2.

## Mini-Plan (chosen approach)

Branch on viewport width and reuse what already exists; keep the bloat-ceiling
files at net-zero line count (className-string swaps only).

1. **Foundation** — `client/src/hooks/useIsCompactViewport.ts` (+ test);
   board scroll-snap + container-overflow utilities in `index.css` (CSS is not
   bloat-tracked → free to grow).
2. **Sidebar** — `SidebarNav.tsx` (120 LOC, free): raise the `matchMedia`
   threshold 768→1023; no structural change.
3. **Board** — `TaskBoardPage.tsx` (650, **net-zero**): add `flex-wrap` /
   `lg:`-gated classes to header rows; add `snap-x` + per-column `snap-start`
   to the existing `overflow-x-auto` columns row via existing className slots.
   - **List view** `TaskList.tsx` (534, **net-zero**): swap secondary columns
     `md:table-cell` → `lg:table-cell` (equal-length). No wrapper-overflow
     change (review H3 — not a safe net-zero on this ceiling file).
   - **Campaigns** `CampaignsLane.tsx` (82, free) / `CampaignLaneCard.tsx`
     (230, free): `flex-wrap` the action/Launch-(Cx) button row; `min-w-0` +
     `truncate` on step labels where missing.
4. **Detail** — keep the single persistent `<PanelGroup>` in
   `TaskDetailThreePane.tsx` (245 LOC, free → keep <300). Add `compact =
   useIsCompactViewport()`; when compact: render a `<PaneTabBar>` (new free
   presentational component, Files/Session/Viewer) + a `centerRef`, set all
   panels `minSize:0` + `collapsible`, imperatively size active→100/others→0 on
   tab change (refit terminal via the existing `useTerminalResize` activation
   path), and `hidden`-class the two `PanelResizeHandle`s. Desktop branch
   (`!compact`) renders the **current JSX unchanged** (byte-identical).
   No component-type swap at `center` ⇒ terminal subtree never unmounts (C1/C2).
   `TaskDetailPage.tsx` (676, **net-zero**) untouched.
5. **Secondary** — `ConfirmDeleteDialog` `max-w-[95vw]`; audit other modals;
   `lg:`-gated container/table tweaks (net-zero on the table files).

### Alternatives considered (Karpathy: Think-Before-Coding)

- **CSS-media-query-only (no JS branch).** Rejected: `react-resizable-panels`
  sets pane widths imperatively via inline styles JS-side; CSS can't cleanly
  override it, and the tab-switch needs JS state. CSS-only would fight the lib.
- **Refactor/split `TaskBoardPage` (650) & `TaskDetailPage` (676) first, then
  add responsive lines freely.** Rejected for this iterate (Surgical-Changes /
  YAGNI): a 650/676-LOC structural split is its own iterate. Net-zero className
  swaps + a new small compact-panes file avoid the anti-ratchet block without a
  risky big-file refactor. The split can be a later, separately-reviewed iterate.

### Plan review (2026-06-14)

External-review keys (OPENAI/GEMINI/GOOGLE) absent → external LLM plan review
**degraded**; substituted the internal `opus-plan-reviewer` agent (Branch-C
fallback; recorded in `degraded[]`). Verdict: **rework AC-4**. Adopted: C1/C2
(no component-type swap at `center`; single persistent `PanelGroup` +
imperative compact sizing so the terminal never unmounts), H1 (outer tabs =
Files · Session · Viewer, not a nested 4-tab), M2 (single SSoT =
`useIsCompactViewport`, not container `measuredWidth`), H3 (list-view = `lg:`
column gating only, no wrapper-overflow swap), M3 (modals out of tablet scope).
All folded into the ACs + Mini-Plan above.

## Affected Boundaries

- **None at the IO/persistence boundary.** This is presentation-only: no API
  routes, no store mutations, no message contracts, no config schemas. (The
  `touches_io_boundary` risk flag does **not** apply.) Backend-affects-Frontend
  rule N/A — no server code changes.
- Touched UI surfaces: app shell, sidebar, board, task-detail panes, modals,
  secondary pages.

## Confidence Calibration

- **Boundaries touched:** Presentation/layout only. No IO, persistence, auth,
  migrations, or public API. No server diff.
- **Empirical probes run** (spec `client/e2e/flows/80-tablet-responsive.spec.ts`,
  17/17 PASS against a real built+served stack; full unit suite 1624/1624; tsc 0):
  - **P1** — chromium at 820×1180: `documentElement.scrollWidth ≤ clientWidth`
    on `/ · /projects · /inbox · /triage · /settings · /diagnostics`; sidebar
    railed (expand affordance shown); board columns carousel (justify-start +
    `scrollWidth > clientWidth`, page not widened). **Finding: PASS** — also
    visually confirmed (screenshots: railed sidebar, flush first column).
  - **P1b** (the C1 guard) — terminal attached, `setViewportSize` across 1024px
    both ways: the `embedded-terminal` element is the **same node** afterwards
    (`isConnected === true`). **Finding: PASS** — no remount, WS/scrollback intact.
  - **P2** — `tsc --noEmit` (exit 0) + vitest: `TaskDetailThreePane` with mocked
    matchMedia renders `<PaneTabBar>` + keeps all three panes mounted across tab
    switches in compact; handles + no tab bar on desktop. **Finding: PASS** (25
    targeted unit tests; 1624 total).
  - **P3** — desktop non-regression: board columns `justify-content` is
    `space-between` at **1024px AND 1280px**; detail keeps visible splitters +
    no tab bar. **Finding: PASS.** Stronger proof: a `git stash` → rebuild of
    pristine origin/main reproduced the SAME 6 broad-spec failures (55/70-d/01)
    seen with my diff → those are pre-existing/environmental (empty isolated
    stack: no projects, Terminal-default inner tab), **not regressions**.
- **Test Completeness Ledger** — principle testable ⇒ tested; 0 testable-untested:

  | # | Behavior (this diff) | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `useIsCompactViewport` ≤1023 compact, reactive, SSR-safe | tested | `useIsCompactViewport.test.ts` (6) |
  | 2 | Sidebar rails at ≤1023 (threshold, not 768) | tested | `SidebarNav.test.tsx` (1023-query) + E2E P1 (rail@820 / expanded@1280) |
  | 3 | Board header wraps; no page overflow at tablet | tested | E2E P1 (no overflow at `/`) |
  | 4 | Board columns justify-start+swipe at tablet; justify-between desktop | tested | E2E P1 + P3 (computed `justifyContent` @820/1024/1280; cols scrollable) |
  | 5 | Board column `snap-start` carousel | tested | E2E P1 (`scrollWidth > clientWidth`) + screenshot |
  | 6 | List view: Commit col hidden <lg / shown ≥lg; fits at tablet | tested | E2E (`task-list-header-commit` hidden@820 / visible@1280; no overflow) |
  | 7 | Campaign card: long step titles truncate (min-w-0+truncate) | tested | `CampaignLaneCard.test.tsx` (truncate/min-w-0) |
  | 8 | Campaign card: action-button row wraps (`flex-wrap`) | untestable (`covered-by-existing-test`) | same expanded-card render path as #7; no seedable campaign on the isolated stack — defensive CSS, no logic branch |
  | 9 | Detail: compact Files/Session/Viewer tabs ≤1023; 3-pane ≥1024 | tested | `TaskDetailThreePane.test.tsx` (4) + E2E (tab-bar@820 / splitters@1280) + screenshots |
  | 10 | Compact: all 3 panes stay mounted across tab switch (terminal never unmounts) | tested | ThreePane unit (panes mounted across clicks) + E2E P1b (same element across crossing) |
  | 11 | Compact tab-sizing does NOT persist (no desktop-width corruption) — **code-review HIGH** | tested | E2E width-guard (defaults 240/480, never compact-clamped) |
  | 12 | `ConfirmDeleteDialog` `max-w-[95vw]` clamp | tested | `ConfirmDeleteDialog.test.tsx` (className); visible effect <463px = iterate-2 scope |

- **Confidence-pattern check:**
  - *Asymptote (depth):* the load-bearing risk (terminal unmount across the
    breakpoint) was probed THREE independent ways — component mount-preservation,
    real-browser same-element-across-crossing (P1b), and the persistent-PanelGroup
    architecture itself. An independent code review caught a HIGH state-corruption
    bug (compact sizing persisting to desktop widths) that all earlier passes
    missed; it is now fixed and E2E-guarded. Depth is high.
  - *Coverage (breadth):* all 6 daily-driver routes + board (both views) +
    campaigns + detail (both modes) + the delete modal, at 820/1024/1280.
    Desktop non-regression empirically proven via the stash-rebuild differential.
  - *Integration composition:* `cross_component` N/A — presentation-only, no
    framework machinery, hooks, or merge/event-log code touched.
  - *Known residual (deferred to iterate-2, phone):* `PaneTabBar` has no
    arrow-key roving-tabindex (a11y LOW, touch-first tablet acceptable); the
    modal-clamp's visible effect is phone-band only; `<768px` layout untouched.

## Reflection (F3a)

- **The review cascade paid for itself twice.** The plan review caught a
  CRITICAL design flaw (a component-type swap at `center` would unmount the live
  terminal across every breakpoint crossing); the code review caught a HIGH
  state-corruption bug (compact `resize(0/100)` leaking into the persisted
  *desktop* pane widths via ungated `onResize`). Both were invisible to a green
  unit suite — empirical adversarial review, not test count, found them.
- **Reusable primitive:** to change a layout *without* unmounting a stateful
  child (xterm + WS), keep ONE persistent host (here the `PanelGroup`) and drive
  it imperatively (size active→100 / others→0) + `forceMount`/CSS-hide — never
  conditionally render a different component type at the same tree position.
- **Differential proof of "not my regression":** a `git stash` → rebuild of
  pristine origin/main reproduced the SAME broad-spec E2E failures (terminal
  default-tab, empty-stack create button) → converted inference into empirical
  fact cheaply. Worth doing whenever isolated-stack E2E noise muddies a verdict.
- **Bloat-ceiling discipline shaped the architecture for the better:** the
  net-zero constraint on the 650/676-LOC files pushed the responsive logic into
  small/new files + className swaps instead of a risky big-file refactor.
- **Deferred (iterate-2, phone):** `PaneTabBar` arrow-key roving-tabindex;
  soft-keyboard terminal affordances; `<768px` reflow; modal-clamp visual check
  at <463px. `collapsible` on the compact Panels was omitted (minSize:0 +
  imperative `resize(0)` suffices — screenshot- and E2E-proven) to keep
  `TaskDetailThreePane` ≤300 LOC.

## Out of scope (explicit)

- Phone (<768px) layout — **iterate 2**.
- Soft-keyboard handling / on-screen terminal input affordances — iterate 2.
- Structural file splits of `TaskBoardPage` / `TaskDetailPage` — separate
  refactor iterate if desired.
- Any backend/server change.
