# Architecture Brief: Mission tab right sidebar

## The problem
Mission tab users cannot see, at a glance, which machine/folder a session runs in, how much context it has used, or which files it produced; they must open the terminal or the file tab. A read-only endpoint (session-info) already exposes this data.

## What already exists here
- Smart Viewer + FolderTree in the Files & Terminal tab (three-pane with resizable panels).
- Mission tab: three glass cards (left summary, activity feed, artifact detail).
- GET /api/external/tasks/:id/session-info (read-only, rescans up to 48 MB per request).

## What would newly, permanently exist
A fourth Mission panel (client only) with its own query hook that polls session-info and a small localStorage layout record; one new CSS file. No new server route, no new write surface.

## Options on the table
- **A:** Right sidebar inside the Mission body with Info/Folders/Viewer segments.
- **B:** Put the same info into the existing left summary panel.
- **C:** Do nothing; keep the information only in the Files & Terminal tab.

## Constraints that are not negotiable
Read-only observer (no JSONL writes); no chat composer/textarea; no percentage for context; the endpoint must not be polled at 1 s.
