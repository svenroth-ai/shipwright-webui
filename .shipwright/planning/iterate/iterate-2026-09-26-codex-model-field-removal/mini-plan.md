# Mini-Plan: iterate-2026-09-26-codex-model-field-removal

**run_id:** iterate-2026-09-26-codex-model-field-removal

## 1. Files to create/modify

- `client/src/components/external/NewIssueModal/CodexModelOverrideFields.tsx` (edit) — remove the "Implementation model" `CodexModelField` render + its param-key constant.
- `client/src/components/external/NewIssueModal/ModelTierOverrideFields.tsx` (edit) — drop the now-dead re-export.
- `client/src/components/external/NewIssueModal/useNewIssueFormSubmit.ts` (edit) — drop the paramValues-read → `body.codexImplementationModel` wiring.
- `client/src/lib/externalApi.ts` (edit) — drop the now-unreachable request-body type field.
- `client/src/components/external/NewIssueModal/ModelTierOverrideFields.codextender.test.tsx` (edit)
- `client/src/components/external/NewIssueModal/NewIterateModal.codex-model.test.tsx` (edit)
- `client/src/components/external/NewIssueModal/payload-launch.codex-model.test.tsx` (edit)
- `client/e2e/flows/codextender-integration.spec.ts` (edit)
- `client/e2e/flows/model-tier-defaults.spec.ts` (edit)
- `.shipwright/planning/01-adopted/spec.md` (edit) — FR-01.74 AC text.

## 2. Work breakdown

1. Remove the field from `CodexModelOverrideFields.tsx` (render + constant + doc comments). Test: existing unit tests for the surviving fields still pass.
2. Remove the re-export + client wiring (`ModelTierOverrideFields.tsx`, `useNewIssueFormSubmit.ts`, `externalApi.ts`). Test: `tsc --noEmit` clean (no dangling import).
3. Update the 3 unit test files named in the operator report to assert the field's absence and retarget surviving-field assertions (datalist/catalog checks move to the Plan-review field, which shares the same `<datalist>`). Test: `vitest run` on those 3 files green.
4. Update the 2 Playwright E2E files discovered by grepping the removed testid (`codextender-integration.spec.ts`, `model-tier-defaults.spec.ts`) the same way. Test: isolated-stack E2E run, both files, real browser.
5. Update `spec.md` FR-01.74's AC to describe the removal and the new "no override sent" behavior for both runtimes.
6. Full client + server typecheck/lint/unit-test suite as a final gate.

## 3. Component hierarchy

`ModelTierOverrideFields` (runtime==="codex" branch) → `CodexModelOverrideFields` → `CodexModelField` × (Plan review, Review). No hierarchy change — one leaf field removed.

## 4. Data model changes

None. This narrows an optional field on the client→server launch POST body; the server's acceptance of that field is unchanged (out of scope, see spec.md's Affected Boundaries note).

## 5. Test strategy

Update existing tests in place (unit: Vitest/RTL; E2E: Playwright against the isolated-stack harness) rather than deleting coverage — each retargets its datalist/catalog assertions onto the surviving Plan-review field (same shared `<datalist>`) and adds an explicit absence assertion for the removed field. No new test layer needed.

## 6. Alternative approach considered (and rejected)

**Alternative:** keep the field but disable it (matching the existing pattern for Plan review/Review under Codextender), showing an explanatory note instead of removing it outright.

**Rejected because:** the operator was explicit — "this field must always be gone for Codex runtime, no exceptions" — and the confirmed product decision ("das normale model das eingestellt ist... das wird genommen") describes a world with no per-task override surface at all, not a disabled-with-explanation one. A disabled field would also misrepresent Codex Light, where the CLI's own `/model` preference is genuinely live and adjustable — disabling it would suggest (wrongly) that no adjustment is possible at all, when the adjustment is simply relocated outside webui.
