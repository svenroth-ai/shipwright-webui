# Iterate Spec — Campaign-C C4 — NewIssueModal split

- **Run-ID:** `iterate-2026-05-26-campaign-C-C4-new-issue-modal-split`
- **Branch:** `iterate/campaign-C-C4-new-issue-modal-split`
- **Base:** `origin/main` @ `ce08c5d`
- **Campaign:** `2026-05-25-bloat-cleanup-C-webui`
- **Sub-iterate:** C4
- **Type:** refactor (change-class = `none`)
- **Surface:** `web` (vitest + Playwright)
- **Complexity:** small (classify_complexity output) — promoted to medium-grade gates because `touches_public_api` risk flag is set AND diff is expected >100 LOC. ADR-029 cascade applies: Step 3.5 plan-review, Step 3.6 self-review, Step 3.7 code-review-cascade (external `--mode code`).

## Goal

Split `client/src/components/external/NewIssueModal.tsx` (1516 LOC) into a `NewIssueModal/` directory with a thin shell + per-mode body components + shared submit hook. Behavior bit-perfect. Both `NewIssueModal.tsx` (1516) and `NewIssueModal.test.tsx` (1292) come out of the bloat baseline by deletion (cleanup-invariant case (b)).

## Discovery — what's actually in the monolith

The spec ("3 mode-specific modals: NewPipelineModal, NewIterateModal, NewTaskModal") is a UI categorisation, but the file actually supports **five** modes:

```
type Mode = "new-task" | "new-pipeline" | "new-iterate" | "new-plain" | "generic";
```

All five share the same `createTask` → `launchExternalTask` POST chain. The mode branches CONTENT (which fields render, which props go into the payload), not the API surface — there is ONE create endpoint (`POST /api/external/tasks`) and ONE launch endpoint (`POST /api/external/tasks/:taskId/launch`).

The three modes named in the spec MUST be split. `new-plain` and `generic` are active production modes (PlainClaudeButton + .webui/actions.json custom actions) — silently dropping either would be a behavior regression. They get parallel body files in the same directory.

## Architecture (post-split)

`client/src/components/external/NewIssueModal/`:

| File | Role | LOC budget |
|---|---|---|
| `index.tsx` | Public re-export of `NewIssueModal` (the dispatcher); preserves the existing `import { NewIssueModal } from ".../NewIssueModal"` for both call-sites without a code change there. | ≤200 |
| `NewIssueModal.tsx` | Top-level dispatcher: reads `action.id` → picks the body component → renders `<ModalShell>` wrapping the chosen body. Owns `open/onOpenChange/action/onTaskCreated/initial*` props + threads them down. | ≤200 |
| `ModalShell.tsx` | Radix `<Dialog.Root>` + portal + overlay + sized content + header (icon tile + title + subtitle + close) + footer (Save + Launch + Esc hint + error display). Width prop (`540px / 580px`). Stable props: `{ open, onOpenChange, mode, action, palette, canSubmit, submitting, error, onSave, onLaunch, children }`. | ≤300 |
| `useNewIssueForm.ts` | The shared submit hook. Owns: form state (`title, description, selectedProjectId, autonomy`), the leadwright 5 fields, the param schema state (`paramValues`, `paramEnabled`, `revealedSecrets`, `advancedOpen`), the debounced `classifyPhase`, the `createTask`/`launchExternalTask` POST sequencer, the sessionStorage handoff for auto-launch. THIS is where payload-shape bit-perfectness lives. | ≤300 |
| `NewTaskModal.tsx` | Body for `mode === "new-task"`. Renders project picker / title / phase dropdown / phase-aware autonomy / description / leadwright fields / required params / advanced params / live CommandPreviewPanel. Reads the shared hook via props. | ≤300 |
| `NewPipelineModal.tsx` | Body for `mode === "new-pipeline"`. Renders project picker / title / autonomy / description / leadwright fields / advanced params (when present) / live CommandPreviewPanel. NO phase dropdown. Pipeline width = 580px. | ≤300 |
| `NewIterateModal.tsx` | Body for `mode === "new-iterate"`. Renders project picker / title / autonomy / description / leadwright fields / advanced params (when present) / live CommandPreviewPanel. NO phase dropdown. Description threads through `body.description` on `/launch` per `project_launch_description_needs_actionid`. | ≤300 |
| `NewPlainModal.tsx` | Body for `mode === "new-plain"`. Title + description only. NO phase, NO autonomy, NO params. | ≤200 |
| `NewGenericModal.tsx` | Body for `mode === "generic"`. Same as Pipeline but command-preview is a static hint, not the live panel. POST body carries `actionId = action.id` (NOT a UI mode string). | ≤200 |
| `PhaseDropdown.tsx` | Extracted Radix DropdownMenu Phase picker (currently 60 LOC inline in NewIssueModal). Imported by `NewTaskModal`. | ≤100 |
| `FieldLabel.tsx` | Extracted shared label primitive (currently 25 LOC inline). Imported by all bodies. | ≤50 |
| `palette.ts` | Per-mode `PALETTE` + `modeIcon` + `modeHeading` + `modeSubheading` pure helpers. Imported by `NewIssueModal` (dispatcher) and `ModalShell`. | ≤150 |
| `paramHelpers.ts` | `paramsToPreview` + `explicitParamEntries` pure functions. Used by bodies + the submit hook. | ≤100 |
| `types.ts` | `NewIssueModalProps`, `Mode`, `SubmitAction`, `ModePalette` shared types. | ≤80 |
| **Test files (NEW — separate from the existing monolithic test):** | | |
| `ModalShell.test.tsx` | ESC closes, backdrop click closes, header renders icon + mode-driven title/subtitle, close button fires onOpenChange(false). | ≤300 |
| `NewPipelineModal.test.tsx` | Empty submit → Launch disabled; valid submit → exact-key POST body. AutonomyToggle visible. | ≤300 |
| `NewIterateModal.test.tsx` | Empty submit → disabled; valid submit → exact-key POST body. `projectId` threaded through. Description persists via the create payload AND launch body. AutonomyToggle visible. | ≤300 |
| `NewTaskModal.test.tsx` | Empty submit → disabled; valid submit → exact-key POST body. Phase dropdown visible. Phase-aware autonomy gating. | ≤300 |
| `useNewIssueForm.test.tsx` | Optional — direct hook coverage for tricky branches (param-enable toggle, sensitive clear-on-disable). Only if extracted. | ≤300 |

## Acceptance Criteria

- [E] `NewIssueModal.tsx` (file) DELETED; `NewIssueModal/` directory exists with the files above.
- [E] Both call-sites (`TaskBoardPage.tsx`, `TriagePage.tsx`) compile and behave identically without import-path changes.
- [E] All 5 modes continue to render correctly (`new-task / new-pipeline / new-iterate / new-plain / generic`).
- [E] Existing `NewIssueModal.test.tsx` (1292 LOC) DELETED — superseded by per-modal test files (each ≤300 LOC).
- [E] All previously-passing test cases (mode rendering, AutonomyToggle gating, FR-03.21 leadwright opt-in, save-to-backlog payload, advanced-params P1+P2+P3, generic Launch posts real `action.id`, `initialProjectId` pre-fill, Plain Claude, regression guards) survive the split — re-asserted in the new per-modal test files.
- [E] `shipwright_bloat_baseline.json` entries for BOTH `NewIssueModal.tsx` and `NewIssueModal.test.tsx` REMOVED.
- [E] Every NEW source file ≤300 LOC. Every NEW test file ≤300 LOC.
- [E] Pre-commit anti-ratchet hook passes (no upward ratchet).
- [E] vitest run pass for the directory; `cmd /c npm.cmd --prefix client run typecheck` passes.
- [E] F0.5 surface verification (`web`) `tests_run >= 8`.
- [E] PR-comment bloat-check workflow reports zero advisory crossings.

## Hard constraints

- Request payload shape for `POST /api/external/tasks` (create) and `POST /api/external/tasks/:taskId/launch` MUST be bit-perfect — preserve exact keys + per-mode conditional omission semantics. RED-first tests capture pre-split bodies, then refactor.
- Description persistence via actionId path stays (memory `project_launch_description_needs_actionid`).
- DO NOT swap Radix Dialog primitive for another library.
- DO NOT touch `scripts/hooks/anti_ratchet_check.py` (canonical-source-hash header).
- DO NOT modify ANY file in the main repo outside `.worktrees/`.

## Spec Impact

- **Classification:** `none`
- **Justification:** Internal refactor. The five modes were already conceptually distinct inside the monolith. The split makes the structure visible without changing externally observable behavior (no payload-shape change, no UI string change, no test-id change).

## Affected Boundaries

| Producer | Consumer | Format | Round-trip probe |
|---|---|---|---|
| `useNewIssueForm` → `createTask` body | `POST /api/external/tasks` route | JSON | vitest mock asserts exact-key body pre-/post-split |
| `useNewIssueForm` → `launchExternalTask` body | `POST /api/external/tasks/:taskId/launch` route | JSON | vitest mock asserts exact-key body pre-/post-split |
| `useNewIssueForm` → `sessionStorage["webui:pending-auto-launch:<taskId>"]` | `LaunchCoordinator` in `TaskDetailPage` | JSON-serialized `{commands, resume, ts}` | preserved verbatim |

`touches_io_boundary` = effectively YES via the request payload — refactor MUST NOT change wire shape. `touches_public_api` is the actual risk flag (the component is consumed by 2 pages). Round-trip probes:

1. **Save-to-Backlog body probe** — for each of the 5 modes, render the body, fill required inputs, click Save, assert `init.body` matches the snapshot captured pre-split.
2. **Launch body probe** — same modes, click Launch, assert the launch POST body matches pre-split.
3. **sessionStorage handoff probe** — Launch path stores `{commands, resume:false, ts:<number>}` under `webui:pending-auto-launch:<taskId>`.

## Confidence Calibration

- **Boundaries touched:** create-task POST body, launch POST body, sessionStorage handoff. Three boundaries.
- **Empirical probes run:** the three above, exhaustively per mode (5 × 2 = 10 body probes minimum).
- **Edge cases NOT probed + why acceptable:**
  - Sensitive-param-clear on toggle-OFF — covered by existing test, re-asserted in `NewTaskModal.test.tsx` advanced-params section.
  - Adopt-phase gating — covered by existing test, re-asserted in `NewTaskModal.test.tsx`.
  - `initialProjectId` Triage Fix-now — covered by existing test, re-asserted in the dispatcher or `NewTaskModal` test (whichever owns reset-on-open).
- **Confidence-pattern check:** runner records `confidence_calibration.status = completed`, asymptote reached when two consecutive probes find zero deltas vs pre-split snapshots.

## External Review + Code Review (ADR-029)

- **Step 3.5 — External Plan Review:** RUN (`uv run --with openai external_review.py --mode iterate`). Address HIGH findings before Build.
- **Step 3.6 — Self-Review:** RUN (7-point checklist after Build).
- **Step 3.7 — Code Review Cascade:**
  - Internal `code-reviewer` subagent — `delegated_to_skill` (no Agent tool available in sub-iterate runner).
  - External LLM code review — RUN (`uv run --with openai external_review.py --mode code --since origin/main`). MANDATORY at this complexity per memory `feedback_external_code_review_catches_high_bugs`. Address HIGH before F6.

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cmd /c npm.cmd --prefix client run typecheck
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/external/NewIssueModal
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "NewIssue|new-iterate|new-task|new-pipeline"
  ```
- **Evidence path:** `.shipwright/runs/iterate-2026-05-26-campaign-C-C4-new-issue-modal-split/surface_verification.json`.
- **`tests_run` MUST be ≥ 8.**

## External Plan Review Findings (Step 3.5)

Provider: `openrouter` (gemini + openai cold-read).

| # | Source | Severity | Category | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | openai | HIGH | approach | Import-path resolution must survive directory swap | accepted-and-fixed: both call-sites use extensionless imports; vitest+vite+ts all resolve `directory/index.tsx`. Verified pre-build. |
| 2 | openai | HIGH | risk | Lifecycle reset tests (open/edit/close/reopen, `initialProjectId` change) | accepted-and-fixed: dispatcher-level test asserts the full open→edit→close→reopen cycle for each mode. |
| 3 | openai | HIGH | edge-case | Duplicate-submit protection (rapid Save/Launch clicks) | accepted-and-fixed: dispatcher test simulates rapid double-click + asserts one POST. |
| 4 | gemini | HIGH | risk | File-to-directory transition needs explicit git rm to avoid Windows/Git tracking issues | accepted-and-fixed: `git rm` the old file FIRST in the same commit that creates the directory. |
| 5 | openai | MED | dependency | Dispatcher-level tests for behavior; body-component tests for rendering only | accepted-and-fixed: payload-shape assertions live in `NewIssueModal.test.tsx`; per-body tests cover field-rendering only. |
| 6 | openai | MED | risk | Extract `resolveMode(action)` as pure helper + cover unknown action.id | accepted-and-fixed: `palette.ts` exports `resolveMode`; covered by unit test. |
| 7 | openai | MED | edge-case | Test prop change (action) while modal open | accepted-and-fixed: dispatcher uses `key={action?.id}` on body element; test asserts mode-switch wipes state. |
| 8 | openai | MED | edge-case | Plain + Generic test files mandatory in AC | accepted-and-fixed: AC list extended (see Acceptance Criteria). |
| 9 | openai | MED | dependency | PhaseDropdown focused interaction test | accepted-and-fixed: `PhaseDropdown.test.tsx` added. |
| 10 | openai | MED | risk | Payload assertions on serialized body string OR exact-key (`hasOwnProperty`) check | accepted-and-fixed: tests assert with `in`/`hasOwnProperty` for omission semantics. |
| 11 | openai | MED | edge-case | classifyPhase debounce race on close/unmount | accepted-and-fixed: cleanup via `clearTimeout` preserved; covered by close-during-debounce test. |
| 12 | openai | MED | security | Sensitive params absent from preview/launch when disabled | accepted-and-fixed: regression test asserts both preview + launch body exclusion. |
| 13 | gemini | MED | edge-case | `commands` origin in sessionStorage handoff | clarified: `commands` is the `launchExternalTask` RESPONSE (not `action.commands`); snapshot updated. |
| 14 | gemini | MED | edge-case | `<ModeBody key={action.id}/>` to force remount on action change | accepted-and-fixed: dispatcher uses keyed body. |
| 15 | openai | LOW | security | Keep action-derived strings as plain text | accepted-and-fixed: no dangerouslySetInnerHTML introduced; all rendering goes through React text nodes. |
| 16 | openai | LOW | dependency | Grep for old file-path references | accepted-and-fixed: pre-build grep checks performed. |
| 17 | openai | LOW | approach | Footer fully driven by hook handlers | accepted-and-fixed: `ModalShell` is presentational; all state/handlers passed in as props. |
| 18 | gemini | LOW | dependency | Relative imports in extracted files need extra `../` | accepted-and-fixed: dispatcher is one level deeper now; imports updated. |
| 19 | gemini | LOW | approach | Move hook instantiation into per-body modal | rejected-with-reason: would lose centralised state on mode-switch. The `key={action.id}` pattern (Gemini #5, accepted) provides the same fresh-on-mode-switch semantic without sacrificing dispatcher-level hook ownership. |

## Acceptance Criteria (updated post-review)

Original AC list extended:

- [E] `NewPlainModal.test.tsx` + `NewGenericModal.test.tsx` exist and pass — both cover create+launch payload shape for their respective modes.
- [E] `PhaseDropdown.test.tsx` exists and asserts label-update + option-select behavior.
- [E] Dispatcher test `NewIssueModal.test.tsx` covers: lifecycle reset (open→edit→close→reopen), `initialProjectId` swap-while-open, mode-switch via `action.id` change while open, duplicate-submit guard, sensitive-param absence from preview+launch when disabled, debounce-race on close-during-classifyPhase.
- [E] `palette.ts` exports `resolveMode(action: ActionDefinition | null): Mode` as a pure helper; unit test covers unknown action.id falling through to `generic`.

## External Code Review Findings (Step 3.7)

Provider: `openrouter` (openai + gemini). Gemini truncated mid-paragraph; reasoned-about-only findings dropped (no actionable Gemini delta beyond what OpenAI raised).

| # | Source | Severity | Category | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | openai | HIGH | spec | Hardcoded `"unassigned"` literal in `useNewIssueForm.ts` seed projection instead of `UNASSIGNED_PROJECT_ID` constant | accepted-and-fixed: imported + used the canonical constant. |
| 2 | openai | HIGH | bug | `onParamEnableToggleImpl` used snapshot-based setState calls (drops updates on rapid toggles) | accepted-and-fixed: switched to functional `setState(prev => next)` pattern to match the monolith. |
| 3 | openai | HIGH | test | No-op smoke test in dispatcher file; missing real `initialProjectId` + `action`-change-while-open coverage | accepted-and-fixed: removed the no-op; added `initialProjectId` swap test + action-change-mid-open test (asserts body remount via `key={action.id}` strips phase-dropdown when swapping task→pipeline). |
| 4 | openai | HIGH | spec | Missing payload probes for new-plain (both), new-iterate launch, generic create | accepted-and-fixed: added 4 new payload tests across `payload-create.test.tsx` + `payload-launch.test.tsx`. Now covers 5 modes × 2 (create+launch) = 10 boundary probes minimum. |
| 5 | openai | MED | test | ESC + backdrop tests requested explicitly | partially-accepted: added explicit ESC keydown test; backdrop click intentionally NOT tested (Radix handles it internally and the integration test would assert Radix Dialog implementation details, not our component contract). |
| 6 | openai | MED | spec | Lifecycle: initialProjectId swap-while-open + mode-switch-via-action.id-while-open coverage | accepted-and-fixed: same as #3 above. |
| 7 | openai | MED | test | PhaseDropdown "callback wired" test was meaningless | accepted-and-fixed: replaced with a color-square attribute assertion that exercises the trigger's current-value branch. |
| - | gemini | n/a | n/a | response truncated mid-paragraph in setter-passing analysis | informational: `useState` setter references are stable, so the implied concern is N/A; no actionable finding to address. |

## Reflection notes (post-build)

Filled during F3a.
