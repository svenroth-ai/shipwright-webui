# Mini-plan — iterate-2026-08-02-mobile-work-mode

## Chosen approach

Keep the current desktop component tree and its terminal-lifecycle guarantees.
At the existing compact breakpoints, change navigation and presentation only:
the compact pane bar directly controls both the physical pane and the existing
controlled centre Transcript/Terminal Radix value, while Task Detail's panes and
Radix tab contents stay mounted. Its existing ResizeObserver/FitAddon reveal path
must produce a settled minimum 5x2 grid after 0→full width and must never forward
an intermediate smaller resize. Mission has separate artifact and compact-panel
UI state; centralized handlers implement the transition table. Its inactive
cards stay mounted under `hidden`, preserving scroll while leaving the tab and
accessibility trees. An artifact click enables and selects Detail.

## TDD step order

1. **Responsive header RED:** extend title/header/description tests for phone
   ellipsis, overlay disclosure, escaped markup-like text, compact Resume, and
   desktop non-regression. Implement with the existing phone hook and a
   portalled `modal` Radix Popover with Escape and deterministic focus return.
   The title overlay includes a Rename action wired to the existing imperative
   edit path after overlay-close + one animation frame; title/description remain
   ordinary escaped React text nodes. Long description content scrolls inside a
   viewport-bounded body on the existing application overlay layer.
2. **Tab hierarchy RED:** extend `PaneTabBar` and `TaskDetailThreePane` tests to
   require four equal direct destinations, saved-preference initialization, and
   preserved centre mount. Pass the existing controlled centre-tab value through
   the layout shell without changing its localStorage key or Radix `forceMount`
   contents. The audited storage hook initializes synchronously in a lazy state
   initializer, so no hydration state or fallback paint is added. Include outer
   compact-pane visibility in `EmbeddedTerminal.active`; pin a cancellable
   post-paint 0→full refit in the existing resize hook and reject grids smaller
   than 5x2 before its socket path. Assert connection identity/count, not mount only.
3. **Terminal geometry RED:** page/component assertions for hidden compact
   centre title band, floating existing `FocusModeToggle`, phone full-bleed
   workspace, and symmetric `TerminalKeyBar` padding. Implement CSS/layout only.
4. **Mission navigation RED:** extend `MissionBody` tests for initial Overview,
   disabled Detail, keyboard navigation, left/prose auto-Detail, toggle-close,
   origin-aware close, manual Overview/Activity hiding with selection preserved,
   breakpoint round-trip, and desktop DOM preservation. Add an equal three-way
   compact tab row and centralized handlers over `activeNode`,
   `activeCompactMissionPanel`, and `detailReturnPanel`. Inactive cards remain
   mounted with native `hidden` so scroll survives but controls leave the
   tab/accessibility trees. Reuse the existing Detail close button and restore
   focus to the recorded source tab after close. Selection is synchronous today,
   so no speculative request-token machinery is added. Do not add a second
   artifact state.
5. **Brand/link RED:** pin `Shiplog` as a link and light branded active states
   regardless of surrounding dark chrome.
6. **Browser integration:** add one focused mobile-work-mode Playwright flow
   covering 390px terminal chrome, terminal mount identity plus non-zero refit,
   Mission transition/keyboard navigation and retained scroll, 820px
   header-workspace coexistence,
   1280px desktop non-regression, and overflow geometry.
7. **Visual/final gates:** real-stack screenshots, client build, full suites,
   typecheck/lint, test hygiene, review cascade, F5/F5c/F11/F12, then delivery.

## Expected files

- `client/src/components/external/EditableTaskTitle.tsx`
- `client/src/components/external/TaskDescriptionDisclosure.tsx`
- `client/src/components/external/mission/MissionTopRow.tsx`
- `client/src/components/external/mission/MissionTabRow.tsx`
- `client/src/components/external/PaneTabBar.tsx`
- `client/src/components/external/TaskDetailThreePane.tsx`
- `client/src/components/external/mission/MissionBody.tsx`
- `client/src/components/terminal/TerminalKeyBar.tsx`
- `client/src/pages/TaskDetailPage.tsx`
- `client/src/styles/mission-record.css` and the existing Task Detail style owner
- colocated RTL tests plus one `client/e2e/flows/mobile-work-mode.spec.ts`
- `.shipwright/planning/01-adopted/spec.md`

## Risks and fences

- **Highest risk:** accidentally unmounting xterm/WS. Fence with existing
  `forceMount`, zero-sized persistent panels, mount-count assertion, and browser
  switching test plus WebSocket/connection-count identity. Zero-sized or
  intermediate <5x2 grids are never forwarded; reveal is settled through the
  existing safe FitAddon/ResizeObserver path.
- **Responsive divergence:** use only the existing 767/1023 breakpoints; no
  third source of truth.
- **Mission duplication:** `activeNode` remains the sole artifact selection;
  separate compact panel/return state follows the explicit centralized
  transition table and never derives a competing document model. Manual
  Overview/Activity preserves `activeNode`.
- **Accessibility regression:** equal visual tabs remain semantic tabs; overlays
  keep accessible trigger/expanded semantics and the native `hidden` attribute
  is never CSS-overridden; terminal touch keys stay 44px.
- **Scope creep:** no server, WS, pty, JSONL, route, or desktop redesign.

## Surface verification

`surface=web`. Run the committed Playwright flow through the real dev stack and
retain its report/screenshots in the run-specific evidence directory. A visual
check alone is insufficient; geometry and state transitions must be asserted.
