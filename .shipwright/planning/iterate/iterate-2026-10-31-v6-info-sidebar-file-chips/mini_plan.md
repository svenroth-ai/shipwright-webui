# Mini plan: V6 info sidebar cards, clickable Outputs, chat file chips, Outside-project viewer header

## Acceptance criteria (derived from the scope)
1. Sidebar tabs are the same `.mc-tabs/.mc-tab` trough as `Mission | Files & Terminal` (no `ft-seg` variant).
2. Info panel = three cards (Environment, Context, Outputs); identical eyebrow heading 12px/600/uppercase in token colour `--body`; Refresh in the first heading; Outputs heading shows `N files`; rows >= 38px, values 14px.
3. Outputs: every row is a full-width >= 40px button with a file icon; "Show all N" replaces "Show more (N)".
4. Every Output opens in the Smart Viewer. Inside-project -> project route (root-relative); outside -> session-file route with the absolute path. Outside rows carry a small `outside project` tag and the full path as tooltip; while the project is still loading rows are disabled (inside/outside unknown).
5. Chat (Mission tab markdown incl. agent/subagent panels): inline-code paths and markdown links to files (absolute or relative, optional `:line` / `#L`) render as `.mc-file` chips; click opens the Smart Viewer in the info sidebar (any collapsed/other segment, compact: Info panel) through the same open path as Outputs. URLs, `console.log`-like names, traversal, UNC and fenced code stay untouched. Outside the Mission provider markdown renders as before.
6. Viewer header for an outside file: name, `Outside project` tag, full path, `Copy path`; no cross-file doc nav / edit / stylesheet inlining for it. Image/video/text/markdown/html/code all work through the session route; pop-out keeps the source.
7. Unassigned tasks offer Info + Viewer (no Folders); their Outputs open as session files.
8. Server unchanged: the V4 session-file route and `core/path-guard.ts` remain the only access authority (unevidenced outside path stays 403).

## Approach
- `lib/viewerTarget.ts` (pure): `parseFileRef`, `targetForAbsolute`, `resolveViewerTarget`.
- `lib/sessionFileApi.ts`: URL + text fetch for the V4 route.
- `FileOpenContext` + `FileChip`; `MarkdownText` InlineCode/MarkdownLink consult the context.
- `useMissionFileOpen` in MissionBody provides the context and a `request` (nonce) the sidebar consumes (switches to Viewer, uncollapses).
- `SmartViewer` gets `sessionTaskId` + `OutsideProjectHeader`; Image/Video/Modal pass it through.
- `MissionInfoPanel` + new `MissionInfoOutputs`; CSS in `mission-sidebar.css` / `mission-chat.css`.

## Tests
Unit: viewerTarget, FileChip/MarkdownText/SmartViewer(outside), MissionInfoSidebar, CSS class fence. E2E (real browser, isolated stack): `V6-info-sidebar-file-chips.spec.ts` incl. outside file + 403 for an unevidenced path.

## Known limits / deviations
- `:line` is parsed and shown on the chip but the viewer does not scroll to the line.
- Chips resolve text only; a chip to a non-existent project file opens the viewer's error state.
- The plain transcript in Files & Terminal (BubbleTranscript) is outside the Mission provider and keeps plain paths.
