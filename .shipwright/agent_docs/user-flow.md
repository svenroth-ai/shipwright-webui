# User Flows

Retrospective design documentation (D2, advisory) — companion to
`screens.md`. Text-only, describing the flows as built.

## 1. First-time user (empty registry)

`/` → `RootRoute` finds 0 projects and 0 tasks → renders `FirstContact`
(lighthouse backdrop) → CTA into `/wizard` → door picker (New / Adopt /
Grade) → `IntentWizardPage` walks the chosen door to step 1 → project lands
in `/projects` → user opens its Ship's Log (`/projects/:projectId/log`,
A16 — the project's home).

## 2. Launching / resuming a task

`/tasks/:taskId` (from the Task Board, Inbox, or a project's Ship's Log) →
`TaskDetailHeader` shows Launch / Resume / Relaunch depending on session
state → explicit click auto-executes the pre-bound `--session-id <uuid>`
command inside the embedded terminal pane (ADR-068-A1; webui never spawns
Claude itself — CLAUDE.md rule 1) → the Mission activity feed narrates
progress by polling the resulting JSONL transcript (1s sequential polling,
no SSE) → PR-status card surfaces once a PR opens.

## 3. Working the Task Board

`/` (with projects present) → kanban board, columns decoupled from session
`state` (rule 23) → drag or `/tasks/:id/column` moves a card between
user-owned board columns → opening a card routes to `/tasks/:taskId`.

## 4. Triage → Fix-now

`/triage` → a triage card's "Fix now" action opens `NewIssueModal` → on
confirm, a new task is created and the flow continues as in Flow 2
(Launch → embedded terminal → Mission feed).

## 5. Org / lead flows (conditional — only when Leadwright is present)

`/org` → roster + org chart. Two flows fork from here:
- **New lead**: header CTA → `/org/new-lead` (`LeadSetupWizardPage`) →
  guided charter setup → back to `/org`.
- **Daily review**: "Last night" header link → `/org/inventory`
  (`LeadInventoryPage`) → per-lead authority-band chips and needs-you
  questions → a question can route into Inbox/Task Board for follow-up.
- **Audit**: `OrgPage` header action → `AuditTimelineModal` — merges every
  lead's audit log into one filterable, time-sorted list (client-side
  merge over the existing per-lead endpoint, no server aggregation).

## 6. File preview pop-out

Any `SmartViewer` (in a task's file tree, Ship's-Log Documents panel, or a
Triage file mention) → "Pop out" → new tab at
`/preview?projectId=&path=` → `PreviewPage` renders the same viewer with
no sidebar chrome, so it can be a bookmarkable/shareable tab.

## 7. Diagnostics / Settings (utility flows)

Reached only via top-level nav, not from another screen's CTA:
`/settings` (runtime + terminal + model-tier defaults) and `/diagnostics`
(CLI/environment health, surfaced automatically when
`MIN_SUPPORTED_CLI` isn't met).
