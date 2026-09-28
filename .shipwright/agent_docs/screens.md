# Screens

Retrospective design documentation (D1/D2). This project was adopted from an
existing codebase (`shipwright-adopt`, 2026-04-30) — the design phase never
ran up front, so this catalog describes the screens as they exist today
rather than a pre-build mockup. Text-only descriptions, per D2's own
allowance. Route table: `client/src/router.tsx`.

## Chrome

`MainLayout` wraps every route below `/` (sidebar nav + command palette +
`SceneBackdrop`). `/preview` is the one route that renders full-screen,
outside this chrome (`PreviewPage`, a pop-out `SmartViewer`).

## Screens

| Route | Component | Purpose |
|---|---|---|
| `/` (index) | `RootRoute` → `TaskBoardPage` or `FirstContact` | Home. Renders the kanban Task Board once any project/task exists; gates to First Contact when the registry is empty (FR-01.51). |
| `/first-contact` | `FirstContact` | Fresh-install hero screen — the guided entry point before any project exists. Always reachable directly (not only via the empty-state gate) so it stays testable. |
| `/wizard`, `/wizard/:door` | `IntentWizardPage` | Guided "door picker" front door for creating/adopting/grading a project (New / Adopt / Grade), ahead of the expert `ProjectWizard`. |
| `/tasks/:taskId` | `TaskDetailPage` | A single task's detail view: header (Launch/Resume/Relaunch CTA), embedded terminal (xterm.js + node-pty auto-execute), Mission activity feed, PR status. |
| `/projects` | `ProjectsPage` | Registry of known Shipwright projects; entry point to a project's Ship's Log and to creating a new project. |
| `/projects/:projectId/log` | `ShipsLogPage` | A single project's home screen (A16, FR-01.60) — Ship's-Log entries plus the Documents panel (specs, iterate mini-specs, agent docs/compliance curation). |
| `/inbox` | `InboxPage` | Cross-project inbox of tasks needing attention (questions, review requests, blockers). |
| `/triage` | `TriagePage` | Triage board over `.shipwright/triage.jsonl` — bug reports / issues awaiting classification, with Fix-now and file-mention linking. |
| `/org` | `OrgPage` | AI-lead org chart/roster view (Leadwright integration); conditionally shown in nav via `useOrgChartPresence()`. |
| `/org/new-lead` | `LeadSetupWizardPage` | Guided setup flow for a new AI lead, reached from an `OrgPage` CTA (not a top-level nav destination). |
| `/org/inventory` | `LeadInventoryPage` | Roster-wide "last night" composite view — per-lead beats, authority-band chips, needs-you questions. Reached from `OrgPage`'s header link, not the sidebar/palette. |
| `/settings` | `SettingsPage` | App-level settings: terminal renderer, runtime/model-tier defaults, Codex integration mode. |
| `/diagnostics` | `DiagnosticsPage` | CLI/environment diagnostics (MIN_SUPPORTED_CLI banner, profile resolution, readiness probes). |
| `/preview` | `PreviewPage` | Full-screen file preview pop-out (`?projectId=&path=`), opened from `SmartViewer`; no sidebar chrome. |

## Navigation surfaces

Two independent readers of the same route `handle.nav` metadata
(`client/src/lib/navDestinations.ts`): the sidebar rail and the command
palette. A route without a `nav` handle (e.g. `/org/new-lead`,
`/org/inventory`, `/preview`) is reachable only via an in-page link/CTA, not
top-level nav — that is a deliberate distinction between a "section" and a
"flow off a section," not an oversight (see `router.tsx` comments).
