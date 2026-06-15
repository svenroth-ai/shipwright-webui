# Iterate Spec — Mobile/Tablet Layout Polish

- **Run ID:** iterate-2026-06-15-mobile-tablet-layout-polish
- **Intent:** CHANGE (responsive UI refinement)
- **Complexity:** medium
- **Spec Impact:** MODIFY (existing responsive behavior FR-01.38/39 polished)
- **Risk flags:** none (frontend-only; touches a layout component → full client test suite at F0)
- **Base commit:** origin/main @ 1da0b6a

## Problem

On the two narrow layouts the Task Board / List / Projects / Sidebar chrome is
cramped or clipped:

- **Phone band (≤767px, hamburger present — incl. small-tablet portrait):** the
  board header packs the project dropdown (220px min) + divider + view toggle on
  one line and the New/Plain-Code buttons on another, with a separate status
  pill row below — too much vertical chrome, buttons wrap awkwardly.
- **Compact band (≤1023px):** the List view Resume button eats horizontal room
  that the Title needs; the Projects table's monospace **Path** column forces a
  bottom horizontal scrollbar.
- **Tablet landscape / icon rail (768–1023px):** the 60px rail clips the
  Inbox/Triage count badges ("open items"); the 3 fixed-360px board lanes
  overflow to the right (cut off), forcing a carousel when the user wants all
  three visible.

## Scope decisions (Sven, interview 2026-06-15)

- Header restructure rides the **existing phone breakpoint** (`useIsPhoneViewport`,
  ≤767px). User confirmed their tablet portrait already shows the hamburger bar
  → no rail-vs-drawer breakpoint change.
- List/Projects space-savers ride the **compact band** (`useIsCompactViewport`,
  ≤1023px) so tablet benefits too.
- Desktop (≥1024px) layout is **unchanged** throughout.

## Acceptance Criteria

| AC | Band | Behavior |
|----|------|----------|
| AC-1 | ≤767px | Project dropdown renders in the top "Shipwright" title bar (next to the brand); the board header no longer renders it on phone. |
| AC-2 | ≤767px | Status filter renders as a single funnel **icon button** between the View toggle and the create buttons; clicking opens a dropdown menu with selectable statuses (multi-select, same Set semantics + counts + reset). The pill row is hidden on phone. An indicator shows when a filter is active. |
| AC-3 | ≤767px | With the dropdown gone from the header row, View toggle + Plain-Code + New buttons share the header line without awkward wrap. (Verified visually + via no-pill-row assertion.) |
| AC-4 | ≤1023px | List view: Resume/Launch renders **icon-only** (no text label); Title column keeps `w-full` and gains the freed horizontal space. Desktop keeps the labeled control. |
| AC-5 | ≤1023px | Projects table: the **Path** column (th + every td) is not rendered → table fits viewport, no bottom horizontal scrollbar. Desktop unchanged. |
| AC-6 | 768–1023px (rail) | Inbox/Triage count badges render as a small overlay on the top-right of the nav icon instead of inline → not clipped by the 60px rail. Expanded sidebar + phone drawer keep the inline badge. |
| AC-7 | 768–1023px (rail) | Board renders all 3 lanes side-by-side without right-cutoff: in the `md`→`lg` band lanes become flexible/narrower (no horizontal scroll); phone (<768px) keeps the snap carousel; desktop (≥1024px) keeps fixed 360px lanes. |

## Affected Boundaries

- `client/src/layouts/MainLayout.tsx` — top bar gains a portal slot for board-injected content.
- `client/src/pages/TaskBoardPage.tsx` — header conditionals (phone: dropdown→slot, pills→icon).
- New `client/src/components/external/StatusFilterMenu.tsx` — icon + Radix dropdown.
- New `client/src/components/external/MobileTopBarSlot.tsx` (context) — portal target.
- `client/src/components/external/TaskList.tsx` — Resume `showLabel={!isCompact}`.
- `client/src/pages/ProjectsPage.tsx` — Path column gated on `!isCompact`.
- `client/src/components/sidebar/SidebarNavItem.tsx` — collapsed badge overlay.
- `client/src/pages/TaskBoardPage.tsx` Column — responsive lane width classes.

No server changes. No new deps (Radix DropdownMenu, lucide Filter icon already present).

## Confidence Calibration
- **Boundaries touched:** MainLayout (layout shell), TaskBoardPage (board header + lanes), TaskList, ProjectsPage, SidebarNavItem, ProjectFilterDropdown, TerminalLaunchButton; two new client components (BoardStatusFilter, MobileTopBarSlot). No IO/persistence/server boundary — pure client render/layout.
- **Empirical probes run:**
  - Built the production client + booted an isolated Hono stack (temp USERPROFILE, :3947) serving the real SPA; ran **37 Playwright tests green** in real Chromium — tablet (chromium @820px) + phone (mobile-chromium / Pixel 5 @393px). Proves the AC-7 lane fit, AC-5 Path-hide, and AC-1/AC-2 portal header in real CSS, not jsdom.
  - Full client unit suite: **1678 passed** (incl. 28 new/edited). Radix multi-select stay-open + portal-slot lifecycle directly asserted.
  - Anti-ratchet check exit 0 — no bloat-baseline ratchet (TaskBoardPage 650→582, ProjectsPage 439, TaskList 534, TerminalLaunchButton 336 all ≤ cap).
  - Desktop non-regression proven: specs 49-project-filter + 90-all-projects-cascade + spec-80 desktop block (justify-between @1280/1024) all green.
- **Test Completeness Ledger:**

  | Behavior (AC) | Disposition | Evidence |
  |---|---|---|
  | AC-1 project dropdown portaled to top bar (phone) | tested | MobileTopBarSlot.test.tsx (state-publish portal) + 90-phone E2E "dropdown moves into top bar" |
  | AC-2 status filter = icon menu, multi-select, no pills (phone) | tested | BoardStatusFilter.test.tsx (open/toggle/stay-open/dot) + 90-phone E2E |
  | AC-3 header row fits without wrap (phone) | tested | 90-phone E2E no-overflow @393px + AC-1/2 E2E (no pill row) |
  | AC-4 List Resume icon-only (compact) | tested | TaskList.test.tsx (`hidden lg:inline`) + 80-tablet "Title widest column" |
  | AC-5 Projects Path column hidden (compact) | tested | ProjectsPage.test.tsx (class) + 80-tablet "no in-card scroll" + 90-phone "no page widen" |
  | AC-6 sidebar badge overlay in rail (not clipped) | tested | SidebarNavItem.test.tsx (overlay when collapsed, inline when expanded) |
  | AC-7 board fits all 3 lanes, narrower, no right cut-off (tablet) | tested | 80-tablet E2E "board fits all three lanes" + "visible without scrolling" (real CSS) |

  0 testable-but-untested; 0 untestable rows. Enumeration basis = the 7 ACs.
- **Confidence-pattern check:**
  - *Asymptote (depth):* the four plan-review risks — portal lifecycle (M1), Radix multi-select close (M3), Tailwind lane cascade (H1), spec-80 carousel contradiction (H2) — each have a direct passing test; H2 reconciled per the Test-Update-Klausel (spec 80's two carousel assertions rewritten in the same diff).
  - *Coverage (breadth):* all 7 ACs across phone + tablet + desktop-non-regression; no `cross_component` machinery touched → no integration-coverage flag.

## Out of scope

- Changing the ≤1023px rail vs ≤767px drawer breakpoints.
- Desktop (≥1024px) header / list / projects / board geometry.
- Any server / data-flow change.
