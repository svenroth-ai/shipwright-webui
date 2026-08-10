# Iterate: Model-tier defaults

**Run ID:** `iterate-2026-08-10-model-tier-defaults`
**Complexity:** small (`touches_io_boundary`)
**Status:** implemented

## Scope

Display the framework-owned effective model defaults for `plan_review`, `review`, `finalization`, and `execution` on a task's selected-project card. Read `shipwright_model_config.json` from the project’s main Git worktree only; WebUI never edits it. Offer only the flags currently declared by `/shipwright-iterate` (`--plan-review-model`, `--review-model`, `--finalization-model`) as opt-in advanced start choices. Execution remains display-only until a framework invocation consumes an execution override.

## Acceptance Criteria

1. A selected project’s four effective tiers are visible with no model-config edit control.
2. Missing or malformed/invalid recognized role values fail soft to inherited tiers and visibly explain the configuration problem.
3. Linked worktrees read the main-worktree config rather than a divergent worktree copy.
4. Selecting a supported Iterate override yields its flag in the generated launch command; unsupported standalone-Plan/execution overrides are not offered.
5. Model-config API supports only project-scoped GET; mutation methods return 404.

## Out of Scope

- Editing `shipwright_model_config.json` or adding a WebUI write surface.
- Inventing flags for standalone Plan or an execution adapter that does not consume one.
- Campaign UI changes.

## Confidence Calibration

- **Boundaries touched:** framework JSON config → server reader/API → React query/card; action schema → launcher command.
- **Empirical probes:** reader unit tests include malformed, invalid role, and divergent linked-worktree config; API-contract tests assert GET-only; browser E2E writes a fixture config, renders all roles, selects `review-model=opus`, and verifies the returned launch command.
- **Test completeness:** all five acceptance criteria have executable test coverage; no untestable behavior remains.
