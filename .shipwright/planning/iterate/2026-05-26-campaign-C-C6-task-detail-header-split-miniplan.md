# Mini-Plan — TaskDetailHeader split (Campaign C / C6)

## File split

```
client/src/components/external/
  TaskDetailHeader.tsx                  # ≤250 LOC — composition root (KEEP)
  TaskDetailHeader.test.tsx             # UNTOUCHED — integration matrix re-runs against shell
  TaskDetailHeader/
    StateBadge.tsx                      # ≤300 LOC — status pill + pulsing dot
    StateBadge.test.tsx                 # ≤300 LOC — 7 states × badge label
    LaunchCTA.tsx                       # ≤300 LOC — Launch button + handleLaunch
    LaunchCTA.test.tsx                  # ≤300 LOC — click + disabled + label
    ResumeCTA.tsx                       # ≤300 LOC — Resume button + handleResume
    ResumeCTA.test.tsx                  # ≤300 LOC — label always "Resume" + click
    TitleEdit.tsx                       # ≤300 LOC — wraps EditableTaskTitle, forwards startEdit
    TitleEdit.test.tsx                  # ≤300 LOC — ENTER commits, ESC reverts
    HeaderMenu.tsx                      # ≤300 LOC — 3-dots dropdown + confirm dialogs
    HeaderMenu.test.tsx                 # ≤300 LOC — state-conditional menu items
```

## Work breakdown — RED → GREEN per sub-component

Order matters: extract leaf sub-components first (StateBadge has no extracted dependencies), wire shell last.

1. **RED:** `StateBadge.test.tsx` (writes tests for the component that doesn't exist yet).
2. **GREEN:** `StateBadge.tsx` (move `STATE_BADGE` constant + the inline `<span>` + keyframes).
3. **RED:** `LaunchCTA.test.tsx`. **GREEN:** `LaunchCTA.tsx` (move `ctaFor() === "launch"` branch + `handleLaunch` + `prewarmPty`).
4. **RED:** `ResumeCTA.test.tsx`. **GREEN:** `ResumeCTA.tsx` (move `ctaFor() === "resume"` branch + `handleResume`). Regression-guard test: label === "Resume" (NEVER "Recover").
5. **RED:** `TitleEdit.test.tsx`. **GREEN:** `TitleEdit.tsx` — thin wrapper around existing `EditableTaskTitle` exposing the `startEdit` imperative handle via ref.
6. **RED:** `HeaderMenu.test.tsx`. **GREEN:** `HeaderMenu.tsx` — the 3-dots Radix DropdownMenu + `confirm-clear-history` inline dialog. Receives task + an `onRename` callback (which the shell wires to TitleEdit's `startEdit`).
7. **Rewire shell:** `TaskDetailHeader.tsx` reduces to layout + composition (header element, breadcrumb, title row, sub-line, actions strip composed from `LaunchCTA` + `ResumeCTA` + `HeaderMenu`; ctaError + menuNotice + debug span; ConfirmDeleteDialog + EditTaskModal). All extracted handlers, state, refs move with their owning sub-component; the shell becomes lift-state-up only for `editOpen` (EditTaskModal trigger), `confirmDeleteOpen`, `showDebug` — these stay shell-level because they are co-opened by multiple sub-components (or unmount-stable).

## State / handler ownership matrix (after split)

| State / handler | Owned by | Why |
|---|---|---|
| `STATE_BADGE` const + `<span>` + keyframes | StateBadge | leaf-level concern |
| `ctaFor()` (private) | shell | called once at top to pick which CTA to render |
| `handleLaunch`, `prewarmPty`, `launchMut`, `copiedLabel` for Launch | LaunchCTA | self-contained |
| `handleResume`, `launchMut` for Resume, `copiedLabel` for Resume | ResumeCTA | self-contained |
| `ctaError` (rendered as the right-anchored alert span under the header) | shell | currently raised by handleLaunch/handleResume; passed via callback prop |
| `titleRef` (`EditableTaskTitleHandle`) | TitleEdit (internal) | `forwardRef` so the shell exposes `startEdit()` to HeaderMenu via prop |
| Rename, Copy UUID, Copy Resume command, Move to project, Move to Backlog, Close, Stop terminal, Delete, Clear terminal history, debug toggle | HeaderMenu | menu surface lives here |
| `confirm-clear-history` inline dialog | HeaderMenu | menu-scoped destructive |
| `menuNotice` + transient span | HeaderMenu | menu-emitted |
| `confirmDeleteOpen` + `ConfirmDeleteDialog` | shell | dialog is in shell layout slot; HeaderMenu raises a callback prop to open it |
| `editOpen` + `EditTaskModal` | shell | dialog in shell layout slot; HeaderMenu raises a callback to open it |
| `showDebug` + `SessionMetadata` | shell | layout-positioned absolute-bar; HeaderMenu toggles via callback |
| `ProjectChipMenu` (`projectPickerOpen`) | shell | anchored to title row; HeaderMenu raises a callback to open it |

## Cross-cutting concerns

- **`useLaunchTask`** is called separately in LaunchCTA and ResumeCTA. The hook returns its own mutation state per call site; this was previously a single `launchMut` shared by both. There is no measurable behavior change — the shared `launchMut.isPending` was only used to disable BOTH buttons, but only one is rendered at a time (per `ctaFor()`), so disabling-during-pending preserves identically.
- **`coord.pendingLaunch`** continues to disable both CTAs (cross-CTA serialization comes from LaunchCoordinatorContext, which is shared).
- **Testid stability:** `cta-launch-in-terminal`, `cta-copy-resume-command`, `task-detail-state-dot`, `task-state-badge`, `task-detail-header`, `task-detail-menu-trigger`, `task-detail-menu-*` — preserved verbatim.

## Test strategy

### Unit (vitest, per sub-component)

- Each sub-component test mounts the component in isolation with mocked hooks/contexts.
- `LaunchCTA` and `ResumeCTA` tests stub `useLaunchTask` + `useLaunchCoordinator` via `vi.mock`.
- `TitleEdit` test exercises ESC/ENTER paths through `EditableTaskTitle` (re-use existing render approach).
- `HeaderMenu` test re-uses the existing `TaskDetailHeader.test.tsx` menu helpers (renderHeader-like factory).

### Integration (existing TaskDetailHeader.test.tsx — UNMODIFIED)

- The existing 27+ tests for CTA state matrix, draft-CTA-respects-prior-run, ⋯-menu copy actions, Close redirect, Move to Backlog, phase badge MUST continue to pass against the new shell. This is the strongest empirical proof that bit-perfect behavior is preserved.

### E2E (Playwright, F0.5)

- `cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "TaskDetail|launch|resume" -x` against a live dev stack on a temp USERPROFILE (memory `feedback_iterate_e2e_isolated_userprofile`).
- Sample specs: 30-launch-copy, 36-rename-title, 43-launch-button-variants, 70-d-task-detail-three-pane.

### Typecheck

- `cmd /c npm.cmd --prefix client run typecheck`

## Risk register

- (R1, MED) Forgetting a stable-prop pass-through breaks a menu item silently — mitigated by the existing TaskDetailHeader.test.tsx integration suite which exercises every menu testid.
- (R2, LOW) `useLaunchTask` called twice (once each in Launch/Resume) creates a new mutation per CTA — measurably no different from a single shared mutation since exactly one CTA is rendered at a time (no parallel pending states possible).
- (R3, LOW) Shell still > 250 LOC after extraction → split HeaderMenu further (e.g. extract Confirm-Clear-History dialog). Pre-empted in the Scope note; the 5-sub-component layout was sized empirically.

## Bloat-baseline update

- REMOVE `client/src/components/external/TaskDetailHeader.tsx` (post-split: ≤250 LOC — under the 300 limit; cleanup-invariant case (a)).
- DO NOT add new entries for the 5 new sub-component files — each is sized ≤300 LOC at creation.
- DO NOT touch `TaskDetailHeader.test.tsx` baseline entry (grandfathered at 736 — left in place, this iterate doesn't modify the test file).

## Surface verification (F0.5)

- `surface=web` per spec.
- Runner: `surface_verification.py --surface web` with `SHIPWRIGHT_NETWORK_PROFILE=local` + temp `USERPROFILE`. Targets the existing prod server on `:3847` if present, OR spawns an isolated server.
- `tests_run` MUST be ≥ 8 (5 components × ≥2 cases each + E2E run).

## Out of scope

- Re-instating `useContinuePipeline()` for the TaskDetailHeader Launch CTA. CLAUDE.md rule 14 lists this as a *future* TaskDetail header concern; today's header does not consume that hook. Adding it would be a behavior change, not a refactor.
- Adding memoization to sub-components. The original component has no memoization; preserving that.
- Renaming testids. Load-bearing for many Playwright specs.
