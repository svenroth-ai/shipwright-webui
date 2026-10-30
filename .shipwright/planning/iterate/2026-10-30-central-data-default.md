# Iterate: Central Web UI data by default, `shared` as the exception — iterate-2026-10-30-central-data-default

Type: FEATURE/CHANGE · Complexity: medium · Spec impact: MODIFY (FR-01.03)

## Why
Standalone mode (iterate-2026-10-29) protected the repo by REFUSING repo writes. The operator wants the opposite
split: files the Web UI itself produces never land in a repo by default, but the operator's own work
(Markdown editor, triage, campaigns, design feedback) always works. So "standalone" disappears as a mode;
central storage becomes the default and a new `shared` mode keeps Web UI data in the repo.

## Acceptance criteria
- AC-1 Stored project flag `shared?: boolean` replaces `standalone`. Absent/false = Web UI data (actions.json, pasted screenshots, the `.code-workspace` file) lives in `<registryDir>/projects/<id>/` (`~/.shipwright-webui`, or `SHIPWRIGHT_DATA_DIR`). `shared: true` = `<repo>/.shipwright-webui/` as before.
- AC-2 No repo-write refusal remains: the `standalone-guard` middleware and the `403 standalone_project_read_only` response are gone. The Markdown editor, triage writes, campaign start and design feedback work for every project.
- AC-3 Creating a non-shared project writes no `.shipwright-webui/` and no `.code-workspace` into the repo (the workspace file goes to the central dir with an absolute folder path); the project folder itself is still created when missing. `updateAutonomy` writes `shipwright_run_config.json` only when it already exists.
- AC-4 Existing projects keep working: actions.json is read from the central dir first, then from the legacy in-repo `.shipwright-webui/` (non-shared only). A reset removes both.
- AC-5 Pasted screenshots of a non-shared project (by project id or cwd inside its repo) land centrally; no `.gitignore` suggestion; `append-gitignore` answers 409 `data_not_in_repo`. A shared project behaves as before.
- AC-6 `POST /api/projects/:id/migrate-data` moves a project's legacy in-repo `actions.json` and `pastes/` to the central dir (copy, verify, then delete; never overwrites an existing central file) and is idempotent.
- AC-7 UI: the wizard checkbox and the project-settings toggle read "Keep Web UI data in the repo (actions.json, screenshots …)", default off; the settings dialog offers "Move to user folder" when legacy data exists; the project card shows a "(shared)" badge for shared projects.
- AC-8 README, guide §5.4, spec FR-01.03 and CLAUDE.md DO-NOT #33 describe the new model. The earlier "Standalone view" display setting is unchanged.

## Out of scope / limits
- Stored `standalone` values in existing `projects.json` are ignored (they were central anyway).
- Tasks with no resolvable project keep the old cwd-based paste location.
- The project id keys the central folder; deleting a project does not yet remove its central folder.

## Tests
Rewritten `standalone-mode*.test.ts`, `project-data-dir-invariant.test.ts`, new migrate tests, wizard test, E2E `107`.
