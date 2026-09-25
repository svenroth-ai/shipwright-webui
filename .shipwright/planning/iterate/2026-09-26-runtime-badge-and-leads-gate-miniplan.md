# Mini-Plan: runtime-badge-and-leads-gate

## Files to create/modify
- `client/src/components/external/RuntimeToggle.tsx` — edit: `availability
  !== "both"` returns `null` instead of a fixed pill.
- `client/src/components/external/EditTaskModalFields.tsx` — edit: drop the
  Codex Light hint paragraph; wrap the Runtime `Field` so it's skipped when
  editable and availability is restricted.
- `client/src/components/external/NewIssueModal/SimpleFields.tsx` — edit:
  `RuntimeFieldFragment` drops its hint constant and returns `null` when
  availability is restricted.
- `client/src/components/settings/CodexSettingsCardFields.tsx` — edit: add
  the reworded Codex Light limitation note near the integration-mode select.
- `client/src/components/external/ClaimFilterToggle.tsx` — edit: gate on
  `useOrgChartPresence()`, `"absent"` → `null`.
- Test files (edit, matching the above): `RuntimeToggle.test.tsx`,
  `EditTaskModal.runtime-availability-race.test.tsx`,
  `CodexSettingsCard.test.tsx`, `ClaimFilterToggle.test.tsx`.
- E2E (new): `client/e2e/flows/runtime-availability-badge-gate.spec.ts`.
- E2E (edit): `client/e2e/flows/leadwright-gate-org-presence.spec.ts` — add
  Claim-toggle assertions to the existing absent/broken cases.

## Work breakdown
1. `RuntimeToggle.tsx` — replace the fixed-pill branch with `return null`.
   Test: `RuntimeToggle.test.tsx` new `it.each` for `claude_only`/`codex_only`.
2. `EditTaskModalFields.tsx` — remove the hint block; condition the whole
   Runtime `Field` on `!editable("runtime") || availability === "both"`.
   Test: `EditTaskModal.runtime-availability-race.test.tsx` updated assertion.
3. `SimpleFields.tsx`'s `RuntimeFieldFragment` — remove the hint constant;
   early-return `null` when `availability !== "both"`.
   Test: covered transitively (no independent branch left) + E2E.
4. `CodexSettingsCardFields.tsx` — add the new hint paragraph, gated on
   `integrationMode === "light" && availability !== "claude_only"`.
   Test: `CodexSettingsCard.test.tsx` two new cases (shown/hidden).
5. `ClaimFilterToggle.tsx` — add `useOrgChartPresence()` gate, mirroring
   `LeadTagFilterToolbarGroup`. Test: `ClaimFilterToggle.test.tsx` gate block
   (mock the hook, 4-state coverage) + extend
   `leadwright-gate-org-presence.spec.ts`'s absent/broken cases.
6. New E2E `runtime-availability-badge-gate.spec.ts` — seed
   `codexAvailability: "codex_only"`, prove NewTaskModal/EditTaskModal show
   no runtime field, task still creates on the forced runtime, and Settings
   shows the moved hint.

## Component hierarchy
- `TaskBoardPage` → toolbar → `LeadTagFilterToolbarGroup` (unchanged) /
  `ClaimFilterToggle` (now gated the same way, sibling not parent/child).
- `NewTaskModal`/`NewIterateModal`/`NewPipelineModal` → `SimpleFields.tsx`'s
  `RuntimeFieldFragment` → `RuntimeToggle`.
- `EditTaskModal` → `EditTaskModalFields` → `RuntimeToggle` (editable) or
  `readonlyValue` (frozen, untouched).
- `SettingsPage` → `CodexSettingsCard` → `CodexSettingsCardFields` →
  `RuntimeToggle` (preview) + new hint paragraph.

## Data model changes
None. `codexAvailability` and the org-chart-presence signal are both
pre-existing, read-only inputs.

## Test strategy
Unit (Vitest): all 5 touched components get updated/new assertions for the
new null-render / gated-render paths, plus a re-run of every pre-existing
test in the same files to prove no regression on the `"both"`/`"present"`
paths. E2E (Playwright, real isolated stack): one new spec for the runtime
badge gate (create + edit + settings legs), one extended existing spec for
the claim-toggle gate (absent + broken legs), one pre-existing regression
spec (`runtime-toggle-codex.spec.ts`) re-run unmodified to prove the `"both"`
availability path still works end-to-end.

## Alternative approach considered — rejected because
**Alternative:** keep `RuntimeToggle`'s fixed-pill display but hide it only
at the two call-site layers (`EditTaskModalFields`/`RuntimeFieldFragment`)
via a wrapper condition, leaving the component itself unchanged.
**Rejected because:** the component's own doc comment already said "there is
no per-task choice left to make, so there is nothing to toggle" and then
rendered something anyway — that mismatch was the actual bug, not a
per-caller display preference. Patching only the two current call sites
would leave the same wrong default for any future consumer (e.g. the
Settings card's own "default runtime" preview, which in fact needed the
same fix and would have been missed by a call-site-only patch). Fixing the
shared component once is the root-cause fix; duplicating the same
conditional at every call site is exactly the kind of per-component fix
CLAUDE.md rule 26's own history (three repeated reports before a
source-scan-level guard fixed it for good) warns against repeating.
