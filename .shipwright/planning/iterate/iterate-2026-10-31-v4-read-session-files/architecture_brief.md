# Architecture Brief: read files outside the project when the session evidences them

## The problem

The Mission UI wants to open files that the agent wrote or mentioned but that live outside the project folder (outputs, chat file chips) in the Smart Viewer. Today the file route only serves paths inside the project root. The WebUI is reachable over Tailscale, so whatever route is added is reachable by anyone on that tailnet.

## What already exists here

- `GET /api/external/projects/:id/file` — project-scoped, path-guard + realpath, extension allowlist, 5 MB cap.
- `core/path-guard.ts` — traversal and symlink-escape checks relative to a root.
- `core/session-info/` — read-only bounded scan of the task's session JSONL; already extracts Write/Edit outputs.
- `core/session-info/small-file.ts` — single-open handle-checked read.

## What would newly, permanently exist

A new read-only GET route keyed by task id and path. It serves a file inside the project, or outside it when the task's own session transcript names that exact path. It holds no state and writes nothing; the session scan is repeated per request.

## Options on the table

- **A:** New task-scoped route: inside project OR session-evidenced path (whole-path match in chat text / tool calls / Write outputs), plus a credential-location denylist.
- **B:** Serve any absolute path on the machine.
- **C:** Extend the existing project file route with an optional "outside" mode.
- **D:** Do nothing; outside-project files stay unviewable in the UI.

## Constraints that are not negotiable

Read-only on Claude's files; the transcript endpoint family stays stateless (no server-side offset cache); path checks use realpath + path.relative; no inline lint/Semgrep suppressions.
