# Iterate: Tablet-view polish (sidebar collapse, board/page cut-off, list title, touch-scroll)

- **Run ID:** `iterate-2026-06-14-tablet-view-polish`
- **Type:** CHANGE (+ BUG for touch-scroll & bottom cut-off)
- **Complexity:** medium
- **Spec Impact:** MODIFY (tablet responsive behavior shipped in FR-01.38/39, PR #139/#140) + bug fixes
- **Base:** `origin/main` @ 64f97e9
- **Reported by:** Sven, real-device tablet UAT 2026-06-14

## Problem

Post-ship tablet UAT surfaced five defects in the ≤1023px responsive layout:

1. **Sidebar can't be collapsed.** `SidebarNav` auto-rails to 60px at ≤1023px and
   shows a hamburger to *expand* → 200px, but once expanded there is **no
   collapse-back control**. The user is stuck at 200px unless the viewport
   crosses the 1023px boundary.
2. **Task Board gets cut off** at tablet width — the un-collapsible 200px sidebar
   steals horizontal room from the 3×360px swipe-carousel; collapsing would be a
   workaround (depends on #1).
3. **Page is cut off at the bottom.** `MainLayout` reserves
   `env(safe-area-inset-bottom)` only on the *phone* path; on a tablet with a
   bottom inset (iPad home-indicator / Safari bottom bar) the bottom of the
   scroll area is obscured.
4. **List-view Title column too narrow.** The title `<td>` has `max-w-0` but no
   `width:100%`, so the auto table-layout crushes it while `whitespace-nowrap`
   columns take their natural width. General small-resolution issue.
5. **Terminal touch-scroll does nothing** on real devices (BUG). `touch-action`
   is set nowhere in the client → the canvas inherits `touch-action: auto`, so the
   browser arbitrates a one-finger vertical drag as a native pan and never hands
   `touchmove` to the existing ADR-132 handler. Unit tests dispatch synthetic
   `TouchEvent`s straight at the element, bypassing arbitration → green while the
   device fails. Matches "never worked, even under Windows."

## Acceptance Criteria

- **AC-1 (Sidebar collapse):** In the compact band (≤1023px, non-drawer), when the
  sidebar is expanded a collapse control returns it to the 60px rail; railed shows
  the expand control. Bidirectional. Desktop (≥1024px) renders neither (always
  200px). Phone drawer (≤767px) unchanged (full labels, no rail chrome).
- **AC-2 (Board reachable):** At tablet width with the rail collapsed, the board
  carousel scrolls to reveal all three columns — the last (Done) column is fully
  reachable, not hard-clipped.
- **AC-3 (Bottom safe-area):** The content scroll container reserves
  `env(safe-area-inset-bottom)`; no-op (0px) on desktop. Bottom content is no
  longer obscured by a device bottom inset.
- **AC-4 (Title greedy width):** In list view the Title column is the widest
  column at every viewport width (greedy column; `whitespace-nowrap` columns size
  to content).
- **AC-5 (Touch-scroll reachable):** The terminal scroll surface sets
  `touch-action: none` so one-finger pan reaches the ADR-132 handler.

## Affected Boundaries

- Pure client/UI (React + Tailwind + CSS). No server, no API, no IO/config
  boundary, no migrations, no build-config files.
- Touches layout-shell components (`MainLayout`, `SidebarNav`) →
  `touches_shared_infra` → full test suite at finalization.

## Plan

| AC | File | Change |
|----|------|--------|
| 1 | `client/src/components/sidebar/SidebarNav.tsx` | Compact-band collapse control in the brand row (mirror of expand hamburger); gate on `useIsCompactViewport()`. |
| 2 | `client/src/pages/TaskBoardPage.tsx` (+ `index.css` if needed) | Verify carousel scrolls; add trailing `scroll-pr-6` if last column is clipped. |
| 3 | `client/src/layouts/MainLayout.tsx` | `padding-bottom: env(safe-area-inset-bottom)` on the content scroll container. |
| 4 | `client/src/components/external/TaskList.tsx` | `w-full` on title `<th>`/`<td>`, keep `max-w-0`+truncate. |
| 5 | `client/src/components/terminal/EmbeddedTerminal.tsx` | `touch-action: none` on the canvas container. |

## Confidence Calibration

- **Boundaries touched:** client UI only — layout shell (`MainLayout`),
  sidebar (`SidebarNav`), board page, list table, terminal canvas. No server /
  API / IO-config / migration boundary.
- **Empirical probes run:**
  - `git grep "touch-action"` over `client/` → **zero hits** → confirms AC-5 root
    cause (canvas inherits `touch-action: auto`).
  - Read `SidebarNav.tsx` → confirmed expand-only control (no collapse-back) →
    AC-1 root cause.
  - Read `TaskList.tsx` title cell → `max-w-0` without `width:100%` → AC-4 root
    cause.
  - Read `MainLayout.tsx` → safe-area-inset-bottom only on phone path → AC-3.
- **Test Completeness Ledger:** see F5 block; every AC → `tested` (unit/E2E) with
  the real-device gesture for AC-5 carved out as `requires-physical-device` for the
  *visual* outcome while the `touch-action` application itself is unit-tested.
- **Confidence-pattern check:** depth — each fix has a read-confirmed root cause,
  not a guess. Breadth — 5 ACs across 5 files, each independently testable; no
  cross-component integration machinery touched (`cross_component` not set).
- **Known limit (AC-5):** synthetic touch in jsdom/Playwright cannot exercise
  `touch-action` gesture arbitration; final sign-off = real-device smoke by Sven.
