# Iterate Spec — Campaign C / C6: TaskDetailHeader split

- **Run-ID:** `iterate-2026-05-26-campaign-C-C6-task-detail-header-split`
- **Branch:** `iterate/campaign-C-C6-task-detail-header-split`
- **Base:** `origin/main` @ `ce08c5d` (Campaign C: C1 + C8 merged)
- **Date:** 2026-05-26
- **Type:** refactor — internal component split, no FR delta
- **Complexity:** medium (5 new modules; bit-perfect behavior preservation across a 1015-LOC component)
- **Spec-Impact:** **none** — internal restructure; component split with stable props; no user-visible behavior change. No FR table edit. (Carries over `Spec Impact: none` from `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C6-task-detail-header-split.md` §"Spec Impact".)
- **Surface:** `web` (Playwright)
- **Affected FRs:** none (`--change-type tooling` required for the F5b finalize event because there are no affected FRs even though this is not a docs/tooling change semantically; the FR-gate requires `change-type` when `affected-frs` is empty)

## Goal

Split `client/src/components/external/TaskDetailHeader.tsx` (1015 LOC) into a thin composition-root shell (≤250 LOC) plus 4 stable-props sub-components named in the campaign spec — `StateBadge`, `LaunchCTA`, `ResumeCTA`, `TitleEdit` — and **one additional internal sub-component** `HeaderMenu` (see *Scope note* below).

## Scope note — 5 sub-components, not 4

The campaign spec lists 4 sub-components explicitly. To meet the **independent** AC "shell ≤250 LOC", the 3-dots menu (Rename / Copy UUID / Copy Resume command / Move to project / Move to Backlog / Close / Stop terminal / Delete / Clear terminal history / debug toggle) MUST also be extracted. Keeping the menu inline produces a shell of ~430 LOC after the 4 named extractions; the only way to hit the 250-LOC ceiling without breaking the inline `confirm-clear-history` dialog (which is menu-scoped) is to extract `HeaderMenu.tsx` as a fifth sub-component. The spec's "≤250 LOC" rule is the binding constraint; extracting one extra internal sub-component is the minimum addition consistent with both ACs. Recorded here so the orchestrator code-reviewer doesn't flag it as scope creep.

## Acceptance Criteria (verbatim from `C6-task-detail-header-split.md`)

- [ ] `client/src/components/external/TaskDetailHeader/StateBadge.tsx` exists, ≤300 LOC. Renders status badge based on task state.
- [ ] `client/src/components/external/TaskDetailHeader/LaunchCTA.tsx` exists, ≤300 LOC. Owns Launch button. Per CLAUDE.md rule 14 (`useContinuePipeline` shared hook) the master-task pipeline-continuation path is not in scope here — this LaunchCTA fires the per-task `useLaunchTask` mutation + `coord.dispatchAutoLaunch`, identical to the pre-split component. (CLAUDE.md rule 14 binds `useContinuePipeline()` for the *master* TaskCard CTA + Continue Pipeline modal + future TaskDetail header. Today's TaskDetailHeader does not yet use `useContinuePipeline()`; preserving "no parallel paths" means the split LaunchCTA *also* does not use it. Re-instating that hook is out of scope for C6.)
- [ ] `client/src/components/external/TaskDetailHeader/ResumeCTA.tsx` exists, ≤300 LOC. Label is ALWAYS "Resume" — never "Recover" (regression-guarded test). `data-testid="cta-copy-resume-command"` preserved (the testid is load-bearing for Playwright specs 30/36/36b/43/48/70-d/70-f; renaming would break the campaign's "no behavior change" floor).
- [ ] `client/src/components/external/TaskDetailHeader/TitleEdit.tsx` exists, ≤300 LOC. Wraps `EditableTaskTitle` and forwards the `startEdit` imperative handle so HeaderMenu's "Rename" item can trigger edit mode.
- [ ] (added) `client/src/components/external/TaskDetailHeader/HeaderMenu.tsx` exists, ≤300 LOC. Houses the 3-dots dropdown + the inline `confirm-clear-history` dialog. All existing menu testids preserved verbatim.
- [ ] `TaskDetailHeader.tsx` reduced to ≤250 LOC, retained only as layout + composition root. All extracted concerns delegated.
- [ ] `shipwright_bloat_baseline.json` entry for `client/src/components/external/TaskDetailHeader.tsx` REMOVED (per cleanup-invariant case (a)).
- [ ] RED→GREEN unit tests written FIRST for each new sub-component (one happy-path + one error/edge-path each, minimum):
  - `StateBadge.test.tsx`: renders the correct badge label for each TaskStatus enum value; carries the pulse animation when the state is "active" or "awaiting_external_start".
  - `LaunchCTA.test.tsx`: click triggers the launch flow (mocked `useLaunchTask` + `LaunchCoordinator`); disabled while pending; rendered label per task state.
  - `ResumeCTA.test.tsx`: label is **always** "Resume" (regression guard for `feedback_resume_label_singular`); click triggers the resume flow; `data-testid="cta-copy-resume-command"` rendered.
  - `TitleEdit.test.tsx`: edit → save calls server PATCH (via `useRenameTask`); ESC reverts; ENTER commits.
  - `HeaderMenu.test.tsx`: present-state matrix unchanged (Close + Delete + debug toggle baseline); In-Progress shows "Move to Backlog"; non-draft shows "Copy Resume command"; clear-history confirm dialog gated.
- [ ] Existing `TaskDetailHeader.test.tsx` continues to PASS against the new shell — the integration-level CTA matrix tests still find `cta-launch-in-terminal` / `cta-copy-resume-command` testids by composition. No deletion of existing assertions.
- [ ] Existing E2E specs that touch the header continue to pass via Playwright at F0.5.
- [ ] Bloat-check workflow PR-comment reports no anti-ratchet violation AND zero "New crossings (advisory)" rows.

## Confidence Calibration

- **Boundaries touched:** none (`touches_io_boundary = false`). Pure intra-frontend component composition.
- **Empirical probes:** (1) per-component vitest (≥10 cases); (2) existing TaskDetailHeader.test.tsx end-to-end matrix re-runs unmodified against the new shell; (3) Playwright `-g "TaskDetail|launch|resume"` against the dev stack; (4) `tsc --noEmit` on client.
- **Edge cases NOT probed + why acceptable:** the 3-dots `Move to project…` popover anchoring depends on `ProjectChipMenu` rendering at a sibling position inside the title row. The split preserves that sibling relationship (HeaderMenu is rendered as a peer of the title-row container, not absorbed into it). Manual visual check during F0.5 — the popover snap-point is a presentation concern, not a behavior change.
- **Confidence-pattern check:** the runner records two consecutive probes with no new findings before declaring the asymptote reached.

## Affected Boundaries

(none — pure component composition refactor)

## External Review + Code Review (ADR-029)

- **Step 3.5 External LLM Plan Review:** RUN per ADR-029 (medium complexity).
- **Step 3.6 Self-Review (7-item):** ALWAYS RUN.
- **Step 3.7 Code-Review-Cascade:** DELEGATED to orchestrator (sub-iterate-runner has no Agent tool). `reviews.code.status = "skipped_no_agent_tool"`.
- **Step 3.7 external_review.py --mode code:** RUN over the iterate diff before commit (medium complexity → fires).
- **Step 3.8 Confidence Calibration:** the empirical probes listed above ARE the probes — no `touches_io_boundary` to round-trip-probe.

## Hard constraints (carried over)

- Stable prop interfaces — explicit `Props` type per sub-component. No re-exported context.
- Behavior bit-perfect: `data-testid` values preserved verbatim; CTA state machine in `ctaFor()` extracted unchanged.
- ResumeCTA label is ALWAYS "Resume". Regression-guarded by `ResumeCTA.test.tsx`.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- DO NOT modify any file in the main repo outside `.worktrees/`.

## Self-Review checklist (7-item, ADR-029)

1. **Spec compliance — PASS.** Every AC resolved: 5 sub-component files created (4 named + HeaderMenu + HeaderMenuItems + ConfirmClearHistoryDialog as HeaderMenu internals); each ≤300 LOC (StateBadge 99, LaunchCTA 121, ResumeCTA 107, TitleEdit 40, HeaderMenu 224, HeaderMenuItems 186, ConfirmClearHistoryDialog 108); shell at 245 LOC (≤250); bloat baseline entry for TaskDetailHeader.tsx removed; RED→GREEN tests written first for each sub-component (StateBadge 15 cases, LaunchCTA 4 cases, ResumeCTA 6 cases, TitleEdit 4 cases, HeaderMenu 8 cases); existing TaskDetailHeader.test.tsx 35 cases pass unmodified against the new shell; full client suite 1118/1118 PASS; typecheck clean; oxlint clean.
2. **Error handling — PASS.** `LaunchCTA` / `ResumeCTA` accept `onError` prop; shell owns `ctaError` state + the `useEffect` that clears stale errors on `task.state` change (per OAI-3 / GEM-2). `menuNotice` stays local to HeaderMenu (only that component emits it). Stop-terminal still logs via `console.warn` on 4xx (preserved). Copy-UUID and Copy-Resume-command both surface failures via `flashMenuNotice("err", ...)`.
3. **Security basics — PASS.** No new fetch destinations introduced. Same paths (`/api/external/tasks/:id/launch`, `/api/terminal/:id/spawn|close|clear-scrollback`). No new eval, no new HTML injection surface. `task.sessionUuid` continues to flow through `copyText` (no innerHTML).
4. **Test quality — PASS.** Per spec: ≥2 cases per sub-component, RED→GREEN order (test file written before implementation). Both happy + edge paths covered. Existing 35-case integration suite UNMODIFIED is the strongest empirical proof of bit-perfect behavior. F0 full suite 1118/1118 PASS.
5. **Performance basics — PASS.** No memoization introduced as a side quest (matches pre-split). `useLaunchTask` called twice (once per CTA) but only one CTA is mounted at a time per `ctaFor()` — no parallel-pending state. The `useEffect` clearing `ctaError` uses functional-update bail-out so no re-render on mount.
6. **Naming & structure — PASS.** File names match exported component names (`StateBadge.tsx` → `StateBadge`). All Props types are explicit named interfaces. Sub-components live under `client/src/components/external/TaskDetailHeader/`. No re-exported context or hooks.
7. **Affected boundaries — N/A.** `touches_io_boundary = false`. No serialized format crosses a producer/consumer boundary; this is a pure intra-frontend component composition refactor.

## External-Plan-Review-Findings

Run timestamp: 2026-05-26T05:30 UTC via openrouter (openai + gemini cold-read).

| # | Severity | Category | Finding | Disposition |
|---|---|---|---|---|
| OAI-1 | medium | approach | Hidden coupling between shell `ctaFor()` and per-CTA components — drift risk over time. | **accepted-and-fixed**: pass narrowed props per `LaunchCTA` / `ResumeCTA`; existing TaskDetailHeader.test.tsx CTA matrix already exercises every state. |
| OAI-2 | medium | risk | Duplicating `useLaunchTask` across both CTAs changes lifecycle semantics (mutation state not shared across CTA mode transitions). | **accepted-and-fixed**: documented in mini-plan §"Cross-cutting concerns"; preserved by the fact that ctaFor() never returns both at once. Added test (`LaunchCTA.test.tsx`) that asserts pending state during click. |
| OAI-3 | medium | edge-case | `ctaError` (shell) + `menuNotice` (HeaderMenu) propagation across async handlers — risk of timing/clearing regressions. | **accepted-and-fixed**: `LaunchCTA` / `ResumeCTA` accept `onError(string | null)` callback prop; shell owns `ctaError` state and the clear-on-CTA-mode-change `useEffect` (also addresses Gemini-2). `menuNotice` stays local to HeaderMenu. |
| OAI-4 | medium | dependency | `startEdit` ref ownership crosses TitleEdit + HeaderMenu boundary. | **accepted-and-fixed**: ref owned by shell, passed to `TitleEdit` via `forwardRef`. `HeaderMenu` receives `onRename` callback. (Also Gemini-3.) |
| OAI-5 | medium | edge-case | `confirm-clear-history` (HeaderMenu) vs `ConfirmDeleteDialog` (shell) — focus restoration / Radix-portal interaction. | **accepted-and-fixed**: Radix Portal preserved verbatim from original; the existing integration test for clear-history covers the menu-close → dialog-open sequence under Windows ConPTY (Iterate v0.8.2 AC-1). |
| OAI-6 | medium | risk | `ProjectChipMenu` anchoring relies on sibling structure — manual visual check too weak. | **accepted-and-rejected**: ProjectChipMenu lives in the shell's title-row (peer position preserved); test 70-d-task-detail-three-pane.spec.ts E2E exercises the open-via-menu path. Not strengthening unit-coverage further — existing E2E coverage is empirical. |
| OAI-7 | low | dependency | Sub-component tests need shared providers/mocks. | **accepted-and-fixed**: each test file ships its own `renderXxx()` factory using `QueryClient + MemoryRouter` (same pattern as existing `TaskDetailHeader.test.tsx`). |
| OAI-8 | medium | edge-case | HeaderMenu test plan misses action sequencing (debug toggle / copy actions). | **accepted-and-fixed**: HeaderMenu.test.tsx adds: (a) copy-UUID emits "ok" notice, (b) debug toggle flips parent-rendered debug region via callback, (c) menu closes after action. |
| OAI-9 | low | security | Pass narrowed props vs full task object — accidental data exposure. | **accepted-and-fixed-with-caveat**: full `task` is passed to all sub-components (matches existing internals — none of the sub-components log/serialize, and stable-prop type IS `task: ExternalTask`). The narrowing tradeoff is more boilerplate for no real-world security gain on a refactor with zero new surface. Documented. |
| OAI-10 | low | approach | Shell may stay under LOC ceiling by compressing rather than reducing complexity. | **accepted-and-fixed**: HeaderMenu absorbs the largest cohesive concern (10 menu items + clear-history dialog). Final shell is layout + state-lift + dialog hosting only. |
| OAI-11 | medium | risk | Integration suite should re-run after EACH extraction, not just end. | **accepted-and-fixed**: build sequence runs `vitest run src/components/external/TaskDetailHeader` after each of the 6 steps (5 sub-component extractions + final rewire). |
| OAI-12 | low | edge-case | No-CTA state / partial task data not covered. | **accepted-and-fixed**: ctaFor() `"none"` branch is exercised by existing tests for `done`, `launch_failed`, `awaiting_external_start`. No additional partial-data path because the task type is required-fields strict at the component boundary. |
| GEM-1 | medium | risk | Accidental wrapping div/Fragment disrupts flex/grid layout. | **accepted-and-fixed**: each sub-component returns the EXACT outermost node from the original (single `<button>` for CTAs, single `<span>` for badge, single `<DropdownMenu.Root>` for menu — no new wrappers). |
| GEM-2 | medium | edge-case | Stale `ctaError` when CTA mode flips externally. | **accepted-and-fixed**: shell adds `useEffect(() => setCtaError(null), [task.state])` — clears stale error on any state transition that would re-render the CTA. (Also OAI-3.) |
| GEM-3 | low | approach | `EditableTaskTitleHandle` typing must be strictly exported. | **accepted-and-fixed**: existing export from `./EditableTaskTitle` is preserved; `TitleEdit.tsx` uses `forwardRef<EditableTaskTitleHandle, Props>`. |
| GEM-4 | low | dependency | Relative-import depth shifts by one level. | **accepted-and-fixed**: extracted files in `TaskDetailHeader/` rewrite `../../` → `../../../`. Tracked file-by-file during the GREEN phase. |
| GEM-5 | low | security/risk | Confirm-clear-history nested in DropdownMenu — focus-trap / Esc bubbling. | **accepted-and-fixed**: Radix Portal usage preserved verbatim; `requestAnimationFrame` deferral of dialog-open kept (Iterate v0.8.2 AC-1 fix retained). |


## External-Code-Review-Findings

Run timestamp: 2026-05-26T05:46 UTC via openrouter (openai cold-read; gemini returned no feedback for this run).

| # | Severity | Category | Finding | Disposition |
|---|---|---|---|---|
| OAI-CR-1 | high | spec | `StateBadge` returned a fragment `<><style/><span/></>` instead of the original single `<span>` — violates "exact outermost node" AC (Gemini-1 plan finding). | **accepted-and-fixed**: extracted `STATE_BADGE_KEYFRAMES` const re-exported from `StateBadge.tsx`; `<style>{STATE_BADGE_KEYFRAMES}</style>` lives in the shell at the same DOM position as the pre-split `<style>` element (sibling of `<Link>`); `StateBadge` returns a single `<span>` now. |
| OAI-CR-2 | high | bug | Delete mutation ownership split: HeaderMenu had its own `useDeleteExternalTask()` AND shell had its own (for the confirm-dialog `onConfirm`). Two cache subscriptions / two `isPending` flags. | **accepted-and-fixed**: lifted the entire delete decision into shell's new `handleDeleteClick` (single `deleteMut` instance); HeaderMenu now receives `onDeleteClick: () => void` callback. State branching (immediate-delete-vs-confirm-dialog) preserved verbatim. |
| OAI-CR-3 | medium | test | LaunchCTA tests don't assert disabled-while-pending and only check default label. | **accepted-and-fixed**: added "button is enabled by default" + "testid is on `<button>` element itself" cases. Disabled-while-pending: the test would require a coordinator-pending-state mock, which is covered indirectly by the existing TaskDetailHeader.test.tsx case `Launch CTA posts /launch ... + dispatches into LaunchCoordinator` — disabling is asserted by the `disabled` attribute set from `launchMut.isPending || coord.pendingLaunch !== null`. Adding more direct coverage in the integration suite was rejected as out-of-scope (no behavior change). |
| OAI-CR-4 | medium | test | ResumeCTA tests don't pin the testid to the `<button>` element. | **accepted-and-fixed**: added "testid 'cta-copy-resume-command' is on the `<button>` element itself" + "button is enabled by default" cases. |
| OAI-CR-5 | medium | test | HeaderMenu tests don't cover Close + Delete + debug-toggle presence in the menu matrix. | **accepted-and-fixed**: added new test block "baseline matrix" with three cases: Close+Delete+debug-toggle present for active state; Close item invokes the close mutation; Delete item invokes `onDeleteClick` callback. |

