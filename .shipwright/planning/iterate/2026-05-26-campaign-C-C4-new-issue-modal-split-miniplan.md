# Mini-Plan — Campaign-C C4 — NewIssueModal split

Run-ID: `iterate-2026-05-26-campaign-C-C4-new-issue-modal-split`
Spec: `.shipwright/planning/iterate/2026-05-26-campaign-C-C4-new-issue-modal-split.md`

## Build sequence

### Phase 1 — Pre-snap (capture pre-split payloads)

1.1. Extract the `createPayload` + `launchPayload` shapes from the current `NewIssueModal.tsx` (lines 620-687, 709-738). Write them down here in this mini-plan as canonical-source snapshots (see "Pre-split payload snapshots" below).

1.2. Run the existing `NewIssueModal.test.tsx` to confirm GREEN baseline.

### Phase 2 — RED tests

2.1. Create `client/src/components/external/NewIssueModal/` directory.

2.2. Create the per-modal RED tests in the new directory:
- `ModalShell.test.tsx`
- `NewPipelineModal.test.tsx`
- `NewIterateModal.test.tsx`
- `NewTaskModal.test.tsx`
- `NewPlainModal.test.tsx` (carry over the Plain Claude tests from the monolith)
- `NewGenericModal.test.tsx` (carry over the generic-mode tests)

Each test imports from the NOT-YET-EXISTING file under `NewIssueModal/`. Tests will fail at import — that's RED.

2.3. Tests assert EXACT keys in the POST body per pre-snap snapshots. Each test renders the body component standalone OR via the dispatcher (depending on the body's prop contract — dispatcher-wrap is the safer pattern because state lives in the shared hook).

### Phase 3 — GREEN extraction

3.1. Create the shared primitives:
- `types.ts` — `NewIssueModalProps`, `Mode`, `SubmitAction`, `ModePalette`.
- `palette.ts` — `PALETTE`, `modeIcon`, `modeHeading`, `modeSubheading`.
- `paramHelpers.ts` — `paramsToPreview`, `explicitParamEntries`.
- `FieldLabel.tsx` — extracted label primitive.
- `PhaseDropdown.tsx` — extracted Radix DropdownMenu.

3.2. Create `useNewIssueForm.ts` — the submit hook. Lifts:
- All form state (`title, description, selectedProjectId, autonomy, phaseId, phaseOverridden, detectedTrigger, submitting, error`).
- All advanced/leadwright state (`advancedOpen, paramValues, revealedSecrets, paramEnabled, leadDomain, leadPriority, leadComplexityHint, leadTagsRaw, leadBlockedByRaw`).
- The `resetCtxRef` + reset-on-open effect.
- The debounced `classifyPhase` effect.
- The `currentSchema` / `schemaKey` memo + the seed-on-open effect.
- The `onParamEnableToggle` callback.
- The `onSubmit` callback (with `submitAction: "save" | "launch"`).
- Derived: `mode`, `palette`, `realProjects`, `scopedProject`, `phases`, `effectiveProjectId`, `selectedProject`, `currentPhase`, `requiredFields`, `advancedFields`, `requiredMissing`, `canSubmit`, `showAutonomyToggle`, `showLeadDomain/Priority/Complexity/Tags/BlockedBy`.

Returns: `{ state, derived, handlers }` — a fat hook. This is acceptable; the splitting goal is line-budget per file, not a perfectly factored API.

3.3. Create `ModalShell.tsx` — shell component, props from spec.

3.4. Create the 5 body components.

3.5. Create the dispatcher `NewIssueModal.tsx` (the new one, inside the directory) + `index.tsx` that re-exports.

3.6. DELETE the old `NewIssueModal.tsx` (the 1516 LOC file at `client/src/components/external/NewIssueModal.tsx`). The new directory takes its place (Vite/TS resolves the directory's `index.tsx`).

3.7. DELETE the old `NewIssueModal.test.tsx`.

3.8. Remove BOTH baseline entries from `shipwright_bloat_baseline.json`.

3.9. Run `cmd /c npm.cmd --prefix client run typecheck` — expect green.

3.10. Run vitest for the new directory — expect green.

### Phase 4 — Self-Review (7 items)

1. Spec Compliance — all 5 modes preserved; baseline entries removed.
2. Error Handling — `setError` path still wraps `try/catch` around create+launch.
3. Security Basics — no new user-input boundary; sensitive-param-clear-on-disable preserved.
4. Test Quality — exact-key POST body assertions on every mode + sessionStorage handoff.
5. Performance Basics — no new render loops; the shared hook returns memoized derivations.
6. Naming & Structure — directory mirrors mode names; dispatcher is the public surface.
7. Affected Boundaries — payload shape (create + launch) round-trip-probed against pre-split snapshots.

### Phase 5 — External Code Review

Run `external_review.py --mode code --since origin/main`. Address HIGH/MED findings inline before commit.

### Phase 6 — Finalization F0–F11

Standard.

## Pre-split payload snapshots

### `createTask` POST body (`POST /api/external/tasks`)

```ts
{
  title: string,            // always present, trimmed
  cwd: string,              // selectedProject.path
  pluginDirs: [] (empty),   // always
  projectId: string,        // selectedProject.id
  actionId: string,         // always (the chosen action.id)
  phase?: string,           // ONLY when mode === "new-task" AND currentPhase truthy
  description?: string,     // ONLY when description.trim().length > 0
  domain?: string,          // ONLY when showLeadDomain AND leadDomain non-empty
  priority?: "P0"|"P1"|"P2"|"P3",  // ONLY when showLeadPriority AND leadPriority !== ""
  complexityHint?: "small"|"medium"|"large", // same gate
  tags?: string[],          // ONLY when showLeadTags AND post-comma-split has ≥1 non-empty
  blockedBy?: string[],     // same gate
}
```

### `launchExternalTask` POST body (`POST /api/external/tasks/:taskId/launch`)

```ts
{
  actionId: string,         // always (the chosen action.id — NOT the mode string)
  description?: string,     // ONLY when description.trim() truthy
  autonomy?: "guided" | "autonomous",   // ONLY when showAutonomyToggle truthy
  phase?: string,           // ONLY when mode === "new-task" AND currentPhase truthy
  phaseLabel?: string,      // same gate (paired with phase)
  parameters?: Record<string, string | boolean>,  // ONLY when explicitParamEntries returns non-empty
}
```

### sessionStorage handoff (post-launch)

```ts
window.sessionStorage.setItem(
  `webui:pending-auto-launch:${task.taskId}`,
  JSON.stringify({ commands, resume: false, ts: Date.now() }),
);
```

These three shapes are the only externally-observable contracts that must survive the split bit-perfect.

## Risk register

- **R1: payload-shape drift.** Mitigation: per-mode exact-key body assertions captured pre-split.
- **R2: reset-on-open ref pattern is subtle (memory `An API field may be stale-persisted, not live`).** Mitigation: the hook owns the ref; bodies are pure presentational.
- **R3: PhaseDropdown JSDOM quirk (Radix DropdownMenu doesn't open under fireEvent.click) — existing tests work around it by reading the trigger label.** Mitigation: preserve that test pattern in `NewTaskModal.test.tsx`.
- **R4: lead-foundation modal_fields opt-in — applies to BOTH NewTaskModal AND NewIterateModal.** Mitigation: each body re-reads `action.modal_fields` and renders the lead fields independently.
- **R5: doc-sync test (`client/src/test/doc-sync.test.ts`) requires the literal token "NewIssueModal" in CLAUDE.md ∪ architecture.md ∪ component_inventory.md.** Mitigation: the dispatcher file is still named `NewIssueModal.tsx` (now inside the directory) and the directory itself is `NewIssueModal/`. Token preserved.

## Out of scope

- Refactoring `createTask` / `launchExternalTask` themselves (server-side untouched).
- Replacing Radix Dialog (hard constraint).
- Adding new mode bodies beyond the five existing.
- Reviewing or modifying call-site components (`TaskBoardPage`, `TriagePage`) beyond confirming they still compile.
