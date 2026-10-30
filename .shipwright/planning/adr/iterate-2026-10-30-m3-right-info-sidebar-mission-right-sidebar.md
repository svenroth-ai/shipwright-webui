# Mission right info sidebar (client-only, no poll timer)

Campaign mission-desktop-style, unit M3. Read-only sidebar in the Mission tab: Info (Environment, Context, Outputs), Folders (FolderTree reuse), Viewer (SmartViewer reuse).

## Architecture Review

Brief options: A sidebar, B extend the left summary panel, C do nothing.
- glm: approve (medium: no standing poll; fetch on open/focus; reuse layout persistence).
- openai: **reject** (prefer Option B; no polling without a freshness requirement).
- Disposition: **overruled by operator**. Sven explicitly specified the right-side Info/Folders/Viewer sidebar as the product goal (Claude desktop app look), so Option B is out. The reviewers' real concern (a standing poll of a 48 MB-rescan endpoint) was removed: session-info is fetched only on Mission entry, window focus, task-state change and an explicit manual Refresh button, with a 30 s staleTime and no timer.
- Internal arms: architecture-internal-reviewer approve; opus-plan-reviewer findings addressed (below).

## External plan review findings (revise from both)
- Path containment (high/medium): accepted-and-fixed. Outputs are relativized against the PROJECT root, dot/traversal segments rejected client side, files open only through the existing path-guarded file route; unit test added.
- RC pill debounce latency: accepted-and-fixed by removing the debounce (no polling); pill is On/Off/Unknown and shows Unknown after an error.
- Sidebar yield below 1700px: accepted-and-fixed. CSS-only (persisted layout untouched), restore covered by unit + E2E tests.
- Loading/error/missing states: accepted-and-fixed, explicit and tested.
- Hand-mirrored types: rejected-with-reason; repo pattern is verbatim mirror + drift guard (DO-NOT #7), guard added.
- Viewer fallback for unrenderable files: rejected-with-reason; SmartViewer already renders its own unknown-type state.

## Opus plan review findings
- `.mc-side` missing from on-photo reset lists: accepted-and-fixed; E2E computed-colour assertion.
- Output paths vs project root (worktree tasks): accepted-and-fixed.
- Unassigned projects: accepted-and-fixed (Info only).
- Scan while hidden: accepted-and-fixed (query disabled when hidden on compact). Desktop CSS-yield with artifact open keeps the query active (documented, low).
- 1024/1280 widths: accepted-and-fixed (E2E).
- Drag edge cases, Home/End: accepted-and-fixed.

## External code review findings
- Model hidden when tokens null: accepted-and-fixed. Root path "/" handling: accepted-and-fixed. 999_999 formats as 1M: accepted-and-fixed. State-change refetch swallowed while hidden: accepted-and-fixed. Dead clause, unassigned segment consistency: accepted-and-fixed.

## Layout persistence
`useThreePaneLayout` keys are specific to the TaskDetail panes; the sidebar follows the same pattern (clamp on read and write, 10 px keyboard steps) under its own key `shipwright:mission-sidebar` rather than coupling to those keys.
