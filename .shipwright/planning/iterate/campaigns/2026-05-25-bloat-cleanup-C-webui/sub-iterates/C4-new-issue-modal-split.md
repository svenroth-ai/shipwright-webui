# Sub-Iterate C4 — NewIssueModal.tsx split

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C4
- **Risk:** Mittel (3 user-facing modals with form validation + API calls)
- **Complexity:** medium
- **Surface:** `web` (Playwright)
- **Branch base:** C3's branch (stacked)
- **Type:** refactor (change with classification = none)

## Goal

Split `client/src/components/external/NewIssueModal.tsx` (1516 LOC) into 1 shell + 3 mode-specific modals: `ModalShell.tsx` + `NewPipelineModal.tsx`, `NewIterateModal.tsx`, `NewTaskModal.tsx`. Behavior bit-perfect.

## Acceptance Criteria

- [ ] (E) New `client/src/components/external/NewIssueModal/ModalShell.tsx` exists, ≤300 LOC. Owns dialog primitive (Radix Dialog), shared header/footer, ESC/backdrop close, and mode-tab switching. Stable props: `{ open: boolean; onClose: () => void; mode: "pipeline" | "iterate" | "task"; onModeChange: (m) => void; children: ReactNode }`.
- [ ] (E) New `client/src/components/external/NewIssueModal/NewPipelineModal.tsx` exists, ≤300 LOC. Form for creating a new full-pipeline project. Calls `POST /api/external/projects` (or equivalent). Stable props: `{ onSuccess: (project: Project) => void; onCancel: () => void }`.
- [ ] (E) New `client/src/components/external/NewIssueModal/NewIterateModal.tsx` exists, ≤300 LOC. Form for creating an iterate inside an existing project. Stable props: `{ projectId: string; onSuccess: (task: Task) => void; onCancel: () => void }`.
- [ ] (E) New `client/src/components/external/NewIssueModal/NewTaskModal.tsx` exists, ≤300 LOC. Form for creating a standalone task (plain Claude session). Stable props: `{ onSuccess: (task: Task) => void; onCancel: () => void }`.
- [ ] (E) Top-level `NewIssueModal.tsx` reduced to ≤200 LOC OR deleted entirely (replaced by `ModalShell` + the 3 mode modals composed inline at call-sites). Either case removes the baseline entry per cleanup-invariant (a) or (b).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `NewIssueModal.tsx` REMOVED.
- [ ] (E) RED→GREEN vitest tests for each modal:
  - `NewPipelineModal.test.tsx`: empty submit → validation error; valid submit → onSuccess called with returned project; API call uses correct endpoint + payload.
  - `NewIterateModal.test.tsx`: same shape — empty + valid submit paths; `projectId` threaded into payload; description persists per memory `project_launch_description_needs_actionid`.
  - `NewTaskModal.test.tsx`: empty + valid submit paths.
  - `ModalShell.test.tsx`: ESC closes, backdrop click closes, mode-tab switch fires `onModeChange`, focus trap respected.
- [ ] (E) Existing E2E spec(s) for new-issue / new-iterate / new-task flow still pass — `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "NewIssue|new-iterate|new-task|new-pipeline"`.
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor; 3 modals were already conceptually distinct inside the monolith.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| `NewPipelineModal` POST body | `server/src/external/.../projects` (route) | JSON |
| `NewIterateModal` POST body | `server/src/external/.../iterates` (route) | JSON |
| `NewTaskModal` POST body | `server/src/external/.../tasks` (route) | JSON |

`touches_io_boundary` = NO. Refactor MUST NOT change request payload shape. Mandatory contract preservation, verified via vitest mocks asserting exact-key request bodies.

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/NewIssueModal
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "NewIssue|new-iterate|new-task|new-pipeline"
  cmd /c npm.cmd --prefix client run typecheck
  ```
- **Evidence path:** vitest log + playwright-report + surface_verification.json.
- **`tests_run` MUST be ≥ 8.**

## Confidence Calibration

- **Boundaries touched:** request-payload shape to 3 server routes.
- **Empirical probes run:** (1) vitest mock asserts exact-key bodies pre/post split — bit-perfect; (2) Playwright E2E creates a real entity through each modal; (3) typecheck.
- **Edge cases NOT probed + why acceptable:** server-side validation paths not re-probed in this iterate — C2 will revisit when splitting routes.ts.
- **Confidence-pattern check:** runner records.

## External Review + Code Review (ADR-029)

- Step 3.5: **RUN** (medium).
- Step 3.7: **RUN**.

## Hard constraints

- Description persistence (`project_launch_description_needs_actionid`): if NewIterateModal currently passes description through actionId path, that wiring stays. No legacy-path regression.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- Radix Dialog primitive stays — no swap to a different dialog library mid-refactor.

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
