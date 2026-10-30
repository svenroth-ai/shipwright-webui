# Mini-plan: M3 right info sidebar (campaign mission-desktop-style)

Run: iterate-2026-10-30-m3-right-info-sidebar. Complexity: medium. FR family: FR-01.66 (Mission tab).

## Goal
Mission tab gets a right sidebar (Smart Viewer pattern: resizable, remembered) with segments Info / Folders / Viewer. Info = Environment, Context, Outputs. Consumes GET /api/external/tasks/:id/session-info (M2).

## Design
- Client mirror of the server types (lib/sessionInfoApi.ts) + server-side drift guard test.
- useSessionInfo: TanStack Query, no timer, staleTime 30 s, refetch on focus / task-state change / manual Refresh.
- MissionInfoSidebar: segments (MissionSegmented), keyboard + pointer splitter, collapse rail, localStorage layout. Folders reuses FolderTree; Viewer reuses SmartViewer; outputs open in Viewer.
- MissionBody mounts it as a 4th panel; MissionCompactTabs gets an "Info" tab; compact = whole card is the tab panel.
- CSS in new styles/mission-sidebar.css. Below 1700px an open artifact card hides the sidebar (no room for four cards).

## Acceptance criteria
- AC1 Info shows Environment (This computer, project folder = task.cwd, Remote Control pill), Context (tokens used + model; never a percentage), Outputs (basename list, newest first, 5 shown + Show more).
- AC2 Clicking an output under the project folder opens it in the Viewer segment; outputs outside it render inert.
- AC3 Folders reuses FolderTree; selecting a file opens it in Viewer.
- AC4 session-info has NO timer: fetched on Mission entry (once stale, 30 s), window focus, task-state change and a manual Refresh button.
- AC5 Remote Control pill is informational: On / Off / Unknown (no data, error, or no session); no debounce (no polling).
- AC5b Loading, error (non-blocking, Refresh recovers) and no-session ({status:"missing"}) states are explicit.
- AC5c Traversal/dot segments in an output path never open in the Viewer (server path guard stays the authority).
- AC6 Width (240-560, keyboard 10px steps + drag), collapsed flag and active segment persist across reload.
- AC7 Phone/compact: an "Info" tab in MissionCompactTabs shows the sidebar; no splitter/collapse; no horizontal overflow.
- AC8 Desktop 1440: no horizontal clip; middle card >= 360px; with an artifact card open below 1700px the sidebar yields.
- AC9 No chat-* testids, no textarea in the Mission body (spec 35); testids mission-side*/env-*.
- AC10 Shapes mirrored verbatim; drift guard session-info-types-sync.test.ts green.
- AC11 Existing Shipwright Mission features (feed cards, PR/commit, stop-hook, gate/decision/inbox) unaffected (existing tests green).

## Tests
Unit: sessionInfoFormat, MissionInfoSidebar, MissionBody.compact Info tab. Server: type-sync guard. E2E: flows/M3-mission-info-sidebar.spec.ts (+ A13 regression).
