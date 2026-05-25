# Sub-Iterate C6 — TaskDetailHeader.tsx split

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C6
- **Risk:** Niedrig–Mittel
- **Complexity:** medium (component split, 4 new sub-modules + shell)
- **Surface:** `web` (Playwright)
- **Branch base:** C8's branch (stacked)
- **Type:** refactor (change with classification = none — internal restructure)

## Goal

Split `client/src/components/external/TaskDetailHeader.tsx` (1015 LOC) into a thin composition-root shell (≤250 LOC) plus 4 stable-props sub-components: `StateBadge`, `LaunchCTA`, `ResumeCTA`, `TitleEdit`. Behavior preserved bit-perfect — this is internal refactoring, not a behavior change.

## Acceptance Criteria

- [ ] (E) New file `client/src/components/external/TaskDetailHeader/StateBadge.tsx` exists, ≤300 LOC. Renders status badge based on task state. Stable props: `{ status: TaskStatus; livePty?: boolean; firstJsonlObservedAt?: string | null }`.
- [ ] (E) New file `client/src/components/external/TaskDetailHeader/LaunchCTA.tsx` exists, ≤300 LOC. Owns Launch button + click → `useContinuePipeline` flow per CLAUDE.md rule 14. Stable props: `{ task: Task; onLaunchClick: () => void; disabled?: boolean; tooltip?: string }`.
- [ ] (E) New file `client/src/components/external/TaskDetailHeader/ResumeCTA.tsx` exists, ≤300 LOC. Always renders "Resume" label per memory `feedback_resume_label_singular` (no `Recover` differentiation). Tooltip carries the recovery disclosure. Stable props: `{ task: Task; onResumeClick: () => void; disabled?: boolean; tooltip?: string }`.
- [ ] (E) New file `client/src/components/external/TaskDetailHeader/TitleEdit.tsx` exists, ≤300 LOC. Title editing (delegates to `EditableTaskTitle` per CLAUDE.md `--name` integration section). Stable props: `{ task: Task; onTitleSave: (newTitle: string) => Promise<void>; readOnly?: boolean }`.
- [ ] (E) `TaskDetailHeader.tsx` reduced to ≤250 LOC, retained only as layout + composition root. All extracted concerns delegated to sub-components.
- [ ] (E) `shipwright_bloat_baseline.json` entry for `client/src/components/external/TaskDetailHeader.tsx` REMOVED (per cleanup-invariant case (a)).
- [ ] (E) RED→GREEN: vitest component tests written FIRST for each of 4 new sub-components (one happy-path + one error/edge-path each). Tests assert behavior, not internal state. At minimum:
  - `StateBadge.test.tsx`: renders correct badge for each TaskStatus enum value; renders "active" tooltip when `livePty=true`.
  - `LaunchCTA.test.tsx`: click triggers `onLaunchClick`; disabled+tooltip respected; rendered label per task state.
  - `ResumeCTA.test.tsx`: label is always "Resume" (regression guard for `feedback_resume_label_singular`); click triggers `onResumeClick`.
  - `TitleEdit.test.tsx`: edit → save flow calls `onTitleSave` with trimmed value; ESC reverts; ENTER commits.
- [ ] (E) Existing E2E specs that touch the TaskDetail header still pass — `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "TaskDetail|launch|resume"`. Server: `SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=<temp>` per memory `feedback_iterate_e2e_isolated_userprofile`.
- [ ] (E) Bloat-check workflow PR-comment reports ✅ no anti-ratchet violation AND zero "New crossings (advisory)" rows.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor. Component split with stable props; no user-visible behavior change. No FR table edit.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| (none — pure component composition refactor) | (none) | n/a |

`touches_io_boundary` = no.

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  # 1. Unit tests (component-level)
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/TaskDetailHeader
  # 2. E2E (regression coverage)
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "TaskDetail|launch|resume"
  # 3. Server lint+typecheck unchanged (sanity)
  cmd /c npm.cmd --prefix client run typecheck
  ```
- **Evidence path:** `.shipwright/runs/<run_id>/surface_verification.json` + vitest log + playwright-report/index.html.
- **`tests_run` MUST be ≥ 8** (4 components × ≥2 cases each + E2E).

## Confidence Calibration

- **Boundaries touched:** none.
- **Empirical probes run:** (1) per-component vitest with click + ARIA assertions; (2) E2E spec for resume-label-singular regression; (3) typecheck.
- **Edge cases NOT probed + why acceptable:** N/A — no I/O boundaries.
- **Confidence-pattern check:** runner records in iterate ADR.

## External Review + Code Review (ADR-029)

- Step 3.5 External LLM Plan Review: **RUN** (`uv run --with openai shared/scripts/tools/external_review.py --mode iterate ...`). Medium complexity → mandatory.
- Step 3.7 Code-Review-Cascade: **RUN** via orchestrator-spawned `code-reviewer` subagent.

## Hard constraints

- Stable prop interfaces — sub-components MUST be plain function components with explicit Props type. No re-exporting context or hooks across the split that didn't already exist.
- Preserve behavior precisely. The CLAUDE.md "Header CTA" rules (memory `project_claude_md_copycommand_drift`) state header CTA replaced CopyCommandCard + LaunchRow — preserve that header-only model.
- Resume label regression guard: ResumeCTA MUST render label "Resume" — never "Recover" (memory `feedback_resume_label_singular`).
- `useContinuePipeline` hook usage stays in LaunchCTA per CLAUDE.md rule 14 (single hook, no parallel paths).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.

## Approach hints

- Subfolder layout: `client/src/components/external/TaskDetailHeader/{StateBadge,LaunchCTA,ResumeCTA,TitleEdit}.tsx`. Parent file `TaskDetailHeader.tsx` imports + composes.
- Move existing styles (Tailwind utility classes) WITH their component to avoid CSS drift.
- If shared types live in `client/src/types/` already, use them. If a sub-component needs new internal types, keep them local (no re-exports).

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
