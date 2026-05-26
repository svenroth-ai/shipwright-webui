# ADR-102 — Campaign C / C6: TaskDetailHeader split into stable-props sub-components

- **Date:** 2026-05-26
- **Status:** Accepted
- **Section:** Campaign C / C6 — Bloat cleanup, webui
- **Run-ID:** `iterate-2026-05-26-campaign-C-C6-task-detail-header-split`
- **Re-Review-Date:** 2026-08-26
- **Incident-Reference:** none

## Context

`client/src/components/external/TaskDetailHeader.tsx` was grandfathered in `shipwright_bloat_baseline.json` at 1015 LOC — 3.4× the 300-LOC ceiling. The pre-split file housed:

- Breadcrumb (`Projects › <name>`).
- State badge (pulsing dot, color-coded to 7 task states).
- Title editor (inline edit + 3-dots "Rename" trigger via imperative handle).
- Phase chip + sub-line (Started… · last event… · model).
- Launch CTA (handleLaunch → /launch → coord.dispatchAutoLaunch → /spawn prewarm).
- Resume CTA (handleResume — label invariant: ALWAYS "Resume", per project memory `feedback_resume_label_singular`).
- 3-dots Radix DropdownMenu (Rename, Edit task, Copy session UUID, Copy Resume command, Move to project, Move to Backlog, Close, Stop terminal, Delete, Clear terminal history, Show/Hide debug).
- Inline confirm-clear-history dialog.
- ProjectChipMenu host (popover anchored to title row).
- ConfirmDeleteDialog host.
- EditTaskModal host.
- ctaError + menuNotice transient feedback spans.
- SessionMetadata debug bar.

Every Campaign C sub-iterate must follow the cleanup-invariant: new sub-modules MUST be ≤300 LOC pre-commit (no fresh `state=grandfathered` entries; webui has no Stop-gate fallback).

## Decision

Split into a thin composition-root shell (`TaskDetailHeader.tsx`, 222 LOC) plus 5 stable-props sub-components named in the campaign spec (`StateBadge`, `LaunchCTA`, `ResumeCTA`, `TitleEdit`, `HeaderMenu`) and 2 internal helpers under `TaskDetailHeader/` (`HeaderMenuItems` for the DropdownMenu.Content JSX, `ConfirmClearHistoryDialog` for the menu-scoped destructive dialog). Each sub-module ≤300 LOC at creation.

Behavior preserved bit-perfect:
- All 35 cases in the existing `TaskDetailHeader.test.tsx` integration suite pass UNMODIFIED against the new shell.
- 43 new sub-component unit tests cover happy + edge paths (RED→GREEN per the spec).
- Full client suite 1124/1124 PASS.
- TypeScript + oxlint clean.

Bloat baseline entry for `TaskDetailHeader.tsx` REMOVED per Campaign C cleanup-invariant case (a) — file still exists, now ≤ 300 LOC.

## Rationale

External plan review (openai + gemini cold-read via openrouter) found 17 medium/low findings; high-priority items were merged into the iterate spec's `External-Plan-Review-Findings` table and addressed before build:

- **OAI-3 / GEM-2 (stale ctaError):** shell adds `useEffect` clearing `ctaError` on `task.state` change (functional-update bail-out so initial mount doesn't dispatch).
- **OAI-4 / GEM-3 (ref ownership):** `titleRef` stays in the shell; `TitleEdit` uses `forwardRef`; `HeaderMenu` receives `onRename` callback.
- **GEM-1 (DOM nesting):** no new wrapper Fragment/div per sub-component; outermost nodes preserved exactly.

External code review (Step 3.7) found 2 HIGH and 3 MEDIUM findings, all accepted-and-fixed pre-commit:

- **HIGH-1 (StateBadge Fragment):** `StateBadge` originally returned `<><style/><span/></>` after first attempt — moved `STATE_BADGE_KEYFRAMES` export back into the shell so `StateBadge` returns a single `<span>`, matching the pre-split outermost node exactly.
- **HIGH-2 (delete-mutation ownership):** initial attempt had `useDeleteExternalTask()` in both shell and HeaderMenu — two cache subscriptions, two `isPending` flags. Lifted delete entirely into shell's `handleDeleteClick`; HeaderMenu now receives `onDeleteClick: () => void` callback. Single mutation instance, lifecycle bit-perfect.

## Alternatives considered

- **(a) 4 sub-components only (campaign spec letter):** the campaign spec lists 4. Rejected because the shell would have stayed at ~430 LOC (above the AC 250-LOC ceiling) without extracting `HeaderMenu`. Scope note in the iterate spec documents the necessity.
- **(b) Memoization (useMemo / useCallback) at sub-component boundaries:** rejected; pre-split component had no memoization. Preserving identical performance characteristics.
- **(c) Re-instate `useContinuePipeline()` for the TaskDetailHeader Launch CTA (CLAUDE.md rule 14):** rejected as out-of-scope for a refactor; today's header does not consume that hook, adding it would be a behavior change beyond a component split.
- **(d) Narrowed prop types (pass `task.state` + `task.taskId` only, not full `task`):** considered (OAI-9 plan review, low severity). Rejected for the boilerplate cost; sub-components don't log/serialize the task, and the stable-prop type `task: ExternalTask` matches the existing surface.

## Consequences

**Positive**
- Each TaskDetailHeader concern is now testable in isolation; new sub-component tests run in <100ms each.
- Cleanup-invariant ceiling enforced: every sub-module ≤ 300 LOC.
- Baseline grandfathered count reduces by 1 (TaskDetailHeader.tsx).
- Resume label invariant is regression-guarded by a dedicated test file (memory `feedback_resume_label_singular`).
- Bit-perfect preservation has empirical proof in 35 unmodified integration cases + 43 new unit cases.

**Negative**
- Cross-component prop wiring slightly more verbose (5+ callback props on HeaderMenu).
- Playwright F0.5 E2E is partially blocked by pre-existing hardcoded `http://localhost:3847` in spec files (e.g. `client/e2e/flows/70-d-task-detail-three-pane.spec.ts` line 21). The vitest integration suite is the empirical surface-level evidence for C6; rewiring the Playwright spec base-URL is its own refactor.

## Chesterton-Fence audit

The pre-split file had several non-obvious patterns that were preserved verbatim:

- `requestAnimationFrame` deferral of Copy-UUID / Copy-Resume-command (resume-cta-rework — Radix focus-scope must release first so `copyText`'s `execCommand` fallback has no active trap).
- `requestAnimationFrame` deferral of clear-history confirm dialog (Iterate v0.8.2 AC-1 — Windows ConPTY Playwright flake).
- `window.setTimeout(80ms)` deferral of project-picker popover open (Radix DropdownMenu's cleanup tick).
- `prewarmPty` fire-and-forget AFTER `coord.dispatchAutoLaunch`, not before (Live-smoke fix 2026-05-05 — original `await prewarmPty()` before dispatch could hang silently).
- "Resume" label unconditional for `(idle | active | draft+launchedBefore)` — no activity-gate (resume-cta-rework 2026-05-16 falsification).

Each is now carried in the comment block of the sub-component that owns it.
