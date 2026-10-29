# Iterate: Standalone mode (zero repo footprint) — iterate-2026-10-29-standalone-mode

Type: FEATURE · Complexity: medium · Spec impact: ADD

## Why
The operator works in customer repositories where `.shipwright-webui/`, a `.code-workspace`
file or a `.gitignore` edit would be noticed. They still want the board, embedded terminal
and Launch/Resume there — with plain Claude sessions and no Shipwright plugins.

## Acceptance criteria
- AC-1 A project can be registered with `standalone: true` (stored in projects.json; toggled via PATCH and the Settings dialog; chosen in the manual-registration wizard).
- AC-2 For a standalone project the webui writes NOTHING under `project.path`: no `.shipwright-webui/`, no `.code-workspace`, no `.gitignore` edit, no `actions.json`, no pasted images, no `shipwright_run_config.json` autonomy write. Proven by a before/after snapshot of a fixture repo.
- AC-3 Per-project files (`actions.json`, `pastes/`) resolve through ONE resolver: `<registryDir>/projects/<id>/` for standalone, `<repo>/.shipwright-webui/` otherwise. `SHIPWRIGHT_DATA_DIR` relocates `registryDir` (and terminal scrollback). A meta-test forbids direct `.shipwright-webui` path joins elsewhere.
- AC-4 Repo-writing routes (markdown `PUT /file`, `design-feedback`, triage + campaign writes) answer `403 standalone_project_read_only` for a standalone project via ONE middleware mounted before them; `append-gitignore` answers 409.
- AC-5 Regular projects behave exactly as before (regression tests).
- AC-6 The webui runs and launches with no Shipwright plugins installed (default launch has no `--plugin-dir`; missing plugin marketplace resolves to null).
- AC-7 README.md and docs/guide.md state unmistakably that the Command Center works without Shipwright (standalone mode, where data lives, `SHIPWRIGHT_DATA_DIR`, how to register).

## Out of scope / known limits
- Navigation is global, so Shipwright-only pages (Triage, Ship's Log) are not hidden per project; for a standalone repo they are empty because no `.shipwright/` exists.
- Flipping the flag later does not migrate existing `actions.json` / pasted images.
- Guard and resolver follow the project entry (id), not the folder: the same folder registered a second time as a regular project is not protected (documented in the guide).
- Triage/campaign writes only ever mutate pre-existing Shipwright files; the middleware refuses them for standalone projects regardless.

## Affected boundaries
projects.json (new stored field), HTTP write routes, filesystem write sites (actions, pastes, project create), env var `SHIPWRIGHT_DATA_DIR`.

## Tests
`server/src/test/standalone-mode.test.ts` (behaviour, real fs), `project-data-dir-invariant.test.ts` (meta), `client/src/components/wizard/ProjectWizard.standalone.test.tsx`.
