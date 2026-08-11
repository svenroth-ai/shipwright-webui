# Iterate specification — model-tier start overrides

- **Run ID:** `iterate-2026-08-10-model-tier-start-overrides`
- **Status:** draft
- **Type / complexity:** change / small (Quick Scout confirmed)
- **Affected FR:** FR-01.16 — Custom action catalog
- **Spec impact:** MODIFY

## Intent

Correct the misplaced model-tier display from the preceding delivery. The
framework-owned `shipwright_model_config.json` remains read-only. Its effective
defaults are useful only at a launch decision, so the WebUI shows them in the
New Iterate dialog and sends a model flag only when the operator explicitly
chooses an override for that run.

## Acceptance criteria

1. Given a task board contains tasks for a project with model configuration,
   when its cards render, then no model-tier summary or model-config request is
   rendered from any task card.
2. Given an operator opens **New Iterate** and expands **More options**, when
   the project default is available, then `PLAN REVIEW` and `REVIEW` are the
   first two fields, each uses the standard label/hint form pattern with the
   right-aligned hint `only for this session`, and each offers a first option
   naming the effective project default without selecting an override.
3. Given the operator leaves either model control at its project-default
   option, when the iterate is launched, then no corresponding model flag is
   sent. Given an operator chooses a tier, the launch payload and generated
   command contain only the matching explicit `--plan-review-model` or
   `--review-model` flag.
4. Given New Iterate is opened, then Finalization and Execution are not offered
   as override controls.
5. Given a standalone task uses phase `Plan`, when its start dialog renders,
   then it does not show a mutable Plan Review control because the current
   `/shipwright-plan` contract has no per-run override flag.

## Scope

- Remove the task-card model summary and its card test.
- Keep the read-only model-config endpoint/reader and use it only in the
  relevant start dialog.
- Make the existing action catalog own the two supported iterate flags; no
  component hardcodes flag strings.
- Update focused unit and Playwright coverage; restore board visual baselines
  affected only by the removed card content.

## Out of scope

- Writing or editing `shipwright_model_config.json`.
- Execution or finalization controls.
- A standalone Plan override before the framework supplies an invocation flag.
- Campaign UI (campaigns have no interactive start dialog).

## Scout and confidence notes

- Planned files span the action catalog, the New Iterate modal, the task card,
  model-config client hook, and focused UI/E2E tests. The only public boundary
  is the existing read-only model-config GET; it is retained rather than
  expanded.
- The change is cross-component but stays inside one client launch flow and
  one existing read-only API. No CI, auth, persistence, or configuration write
  surface changes.
- Empirical probes: focused unit tests prove presentation and payload omission;
  Playwright verifies a real launch command and no card display.

## Test completeness ledger

| Behaviour | Disposition | Evidence |
|---|---|---|
| Cards do not show/fetch tiers | tested | Task-card unit/E2E assertion |
| Iterate controls use project defaults | tested | modal unit + Playwright |
| Explicit selection emits only supported flag | tested | payload unit + Playwright launch assertion |
| Unsupported controls remain absent | tested | modal unit + Playwright assertion |
| Standalone Plan has no mutable no-op | tested | modal unit/E2E assertion |
