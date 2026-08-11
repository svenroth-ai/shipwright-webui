# Mini-plan — model-tier start overrides

- **Run ID:** `iterate-2026-08-10-model-tier-start-overrides`
- **Complexity:** small

## Files and approach

1. Edit the model parameters in `server/src/config/default-actions.json` so
   only the two framework-supported Iterate overrides remain and their schema
   stays the source of the CLI flags.
2. Add a small New Iterate-only presentation fragment that reads the selected
   project's effective tiers, renders the two standard form fields before all
   other More-options content, and keeps the project-default choice disabled
   from flag emission.
3. Remove `ModelTierSummary` from `TaskCard` and delete its now-orphaned unit
   test/component.
4. Update focused modal, task-card, API and Playwright tests, including visual
   snapshots if the removed card content changes existing board captures.

## Component shape

`NewIterateModal` → `ModelTierOverrideFields` → `useModelTierConfig` → existing
read-only `/model-config` route. `NewTaskModal` remains schema-driven and does
not introduce a no-op Plan override.

## Data and safety

No project files are written. The only model data path remains the existing
read-only model-config reader. The launch request uses action-catalog metadata
for flags; the presentation component addresses schemas by their declared
parameter identity and never invents a new CLI contract.

## Test strategy

Run focused Vitest modal/task-card/API tests, the targeted Playwright flow,
then the normal client/server suites and the required finalization checks.
