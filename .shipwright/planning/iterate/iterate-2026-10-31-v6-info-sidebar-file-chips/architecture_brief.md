# Architecture Brief: open every file (also outside the project) in the Smart Viewer from Outputs and chat

## The problem
In the Mission tab the right info sidebar lists Outputs, but files outside the project folder (e.g. a scratchpad in the temp dir) are dead text, and paths the assistant writes in chat are not clickable at all. Users cannot look at a file the assistant just mentioned or wrote unless it sits inside the project tree.

## What already exists here
- A project-scoped file route and the Smart Viewer (renderers for md/code/html/image/video) used by the Folders tree.
- A task-scoped read route (`/api/external/tasks/:id/session-file`) that serves a file inside the project, or outside it only when this session evidences the path.
- `MarkdownText` (react-markdown) renders all assistant text; the Mission info panel already lists session Outputs.

## What would newly, permanently exist
A small client-side path-to-target resolver (inside project -> project route, otherwise -> session-file route), a React context through which markdown in the Mission tab can open the viewer, a chip component for file paths in chat, and an "Outside project" header in the viewer. No new server surface, no new storage; the existing session-file route stays the only authority for access.

## Options on the table
- **A:** Chips and Outputs both call one client resolver; markdown consults an optional context; viewer gets a `sessionTaskId` source.
- **B:** Route everything (including inside-project files) through the session-file route and drop the project-route distinction in the viewer.
- **C:** Do nothing: keep Outputs for inside-project files only and leave chat paths as plain text.

## Constraints that are not negotiable
Read-only (no writes to the user's files or Claude JSONL); the server's path guard and session-evidence rule stay the only access control; no chat composer / chat-* surfaces; markdown stays XSS-safe (no raw HTML).
