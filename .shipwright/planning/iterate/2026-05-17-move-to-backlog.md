# Iterate Spec: move-to-backlog

- **Run ID:** iterate-2026-05-17-move-to-backlog
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented

## Goal

Let the user move an In-Progress task back to the Backlog column of the
TaskBoard. Today task state only flows forward (`/launch` → in-progress,
`/close` → done) — there is no path back to `draft`. This adds a
`POST /api/external/tasks/:id/backlog` endpoint plus a "Move to Backlog"
action in both the TaskCard and the TaskDetailHeader `…` menus.

## Acceptance Criteria

- [x] AC-1 — `POST /api/external/tasks/:id/backlog` flips an in-progress
  task's `state` to `draft`. Accepts the five in-progress states
  (`awaiting_external_start`, `active`, `idle`, `jsonl_missing`,
  `launch_failed`); returns `409 backlog_invalid_state` for `done`;
  returns `200` idempotently for a task already `draft`. `404` for an
  unknown task id. `ELOCKED` on persist surfaces as `409`.
- [x] AC-2 — The endpoint preserves every history field
  (`launchedAt`, `firstJsonlObservedAt`, `lastJsonlSeenMtimeMs`,
  `actionId`, `phase`, `phaseLabel`, inbox). Only `state` changes.
- [x] AC-3 — After a task is moved to backlog, the transcript-poll state
  machine in `GET /tasks/:id/transcript` keeps it `draft` (sticky):
  neither the `result==="ok"` branch nor the `result==="missing"` branch
  transitions a `draft` task to another state.
- [x] AC-4 — TaskCard `…` menu shows a "Move to Backlog" item ONLY for
  the five in-progress states; hidden for `draft` and `done`. Clicking it
  moves the task (no confirm dialog) and the card relocates to the
  Backlog column.
- [x] AC-5 — TaskDetailHeader `…` menu shows the same "Move to Backlog"
  item under the same visibility rule; clicking it flips the state badge
  to "Draft" in place (no navigation).
- [x] AC-6 — A `draft` task whose `firstJsonlObservedAt` is set renders a
  **Resume** affordance, not a fresh **Launch**: TaskCard renders the
  orange Resume button (`resume={true}`) and TaskDetailHeader's `ctaFor()`
  returns `resume`. A `draft` task without `firstJsonlObservedAt` keeps
  the green Launch button (unchanged). This prevents the "Session ID
  already in use" failure of a fresh launch against an existing JSONL.

## Spec Impact

- **Classification:** add
- **ADD** (new FR appended): FR-01.32 — Move task to backlog (POST).
  Plus a new acceptance-criterion bullet on FR-01.01 (Task board) for the
  board-level menu UX + the Resume-vs-Launch rendering rule.
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope

- Drag-and-drop between board columns — agreed as a SEPARATE follow-up
  iterate (would add `@dnd-kit`, rebuild TaskBoardPage column rendering,
  trigger `touches_build`). The follow-up builds on this run's endpoint
  (drag→Backlog) plus the existing `/close` (drag→Done). Noted as a
  follow-up triage item at finalization.
- Moving a `done` task back to backlog (re-opening a closed task) — the
  user scoped the action to In-Progress tasks only.
- Any change to `shipwright_run_config.json` — webui stays a read-only
  observer of run-config (DO-NOT guard #12). Moving a pipeline phase-task
  shadow to backlog only relabels the webui shadow; documented as known
  drift in the ADR.
- A confirm dialog — the action is non-destructive and trivially
  reversible (Resume/Launch), so it executes immediately like
  "Close (mark done)".

## Design Notes

Design Check — Tier 2 (markdown). No new mockup; the kanban mockup does
not depict dropdown-menu internals. No new component, no layout change —
two `<DropdownMenu.Item>` entries reusing each surface's existing Radix
dropdown styling verbatim.

- **Label:** "Move to Backlog" (plain, no parenthetical). Maps 1:1 to the
  visible Backlog column header. The internal `draft` term is NOT exposed
  to the user (jargon).
- **TaskCard menu** — items are text-only there (siblings "Close (mark
  done)" / "Delete (remove from board)" carry no icon). "Move to Backlog"
  is text-only too, placed FIRST (least-destructive action on top):
  `Move to Backlog · Close (mark done) · Delete (remove from board)`.
- **TaskDetailHeader menu** — items carry a leading lucide icon there.
  "Move to Backlog" uses `Undo2` (move-back semantic; distinct from the
  `X` of Close/Stop and the `Trash2` of Delete; `ArrowLeft` is reserved
  for the header back-nav). Placed at the top of the state-action group,
  right after the separator, before "Close task":
  `… Move to project… │ ─── │ Move to Backlog · Close task · Stop
  terminal session · Delete task · Clear terminal history │ ─── │ …`.
- **No confirm dialog** — executes immediately (decided; non-destructive,
  reversible). Matches "Close (mark done)" which also has no confirm.
- **Resume-vs-Launch (AC-6):** no new visual — the orange Resume button
  (`TerminalLaunchButton variant="solid" color="orange"`) on the card and
  the existing header Resume button are simply rendered in place of the
  green Launch when the `draft` task has `firstJsonlObservedAt`. State
  badge for a backlogged task is the existing grey "Draft" badge.

## Affected Boundaries

n/a — the endpoint writes `state: "draft"` into `sdk-sessions.json`, but
`state` is a pre-existing field and `draft` is already in the loader's
`validStates` allowlist. No serialized-format or producer/consumer
contract change → not an IO boundary. The classifier did not raise
`touches_io_boundary`.

## Confidence Calibration

- **Boundaries touched:** none (see Affected Boundaries — n/a). `state`
  is a pre-existing field; `draft` a pre-existing value; no
  serialized-format change.
- **Empirical probes run** (all RAN + GREEN, not code-reading):
  1. Transcript-poll stickiness, BOTH branches AND both
     `firstJsonlObservedAt` cases — `routes.backlog.test.ts` drives a
     real task to `draft`, then polls `GET /transcript` against an
     `ok`-status AND a `missing`-status watcher stub; asserts `state`
     stays `draft` across repeated polls. Covers (a) `draft` +
     `firstJsonlObservedAt` set, and (b) `draft` + `firstJsonlObservedAt`
     UNSET — the case the external code review (gemini, HIGH) caught:
     the `ok`-branch `if (!firstJsonlObservedAt)` arm previously bumped
     such a task to `active`. The fix records `firstJsonlObservedAt` but
     gates the `→active` transition on `state !== "draft"`; the probe
     asserts both `state` stays `draft` AND `firstJsonlObservedAt` is
     recorded.
  2. Endpoint allowlist — `it.each` over all five In-Progress states →
     `200` + `state==="draft"`; `done` → `409 backlog_invalid_state`;
     already-`draft` → idempotent `200`; unknown id → `404`.
  3. History-field preservation — a task with every history field
     populated (incl. object-shaped `inbox`) is moved to backlog; a
     deep-equality assertion confirms only `state` changed.
  4. ELOCKED — `store.persist` stubbed to throw `{code:"ELOCKED"}` →
     route returns `409`.
  5. Resume-vs-Launch rendering — `TaskCard` + `TaskDetailHeader` tests:
     `draft` + `firstJsonlObservedAt` → Resume affordance; never-launched
     `draft` → green Launch (regression fence).
  6. `hasLaunchedBefore` predicate — `taskLifecycle.test.ts` probes
     non-empty string (true), `undefined` (false), AND empty string
     (false) — covers OpenAI review finding #5's malformed-field concern
     at the predicate level.
  7. End-to-end menu-UX round-trip — `e2e/flows/move-to-backlog.spec.ts`:
     create → launch (`awaiting_external_start`) → card in
     `column-in-progress` → ⋯-menu "Move to Backlog" → card relocates to
     `column-draft` + the now-`draft` card's ⋯-menu no longer offers the
     item + `GET /tasks/:id` confirms `state==="draft"`. (Executed at
     F0.5.) NOTE: the E2E drives `awaiting_external_start` (no JSONL is
     produced), so the transcript-poll stickiness guard (AC-3) is
     exercised E2E-equivalently only by probe #1's route-level stub
     tests — not by a live JSONL. This is a deliberate scoping call: a
     live JSONL needs a real Claude process, out of an E2E's control.
- **Edge cases NOT probed + why acceptable:**
  - Concurrent double-click on "Move to Backlog" — not driven with a
    real concurrency test. Acceptable: the endpoint is idempotent for
    `draft` (`200`, no 409) and the mutation reconciles cache from the
    returned task payload; the menu item is hidden once `state==="draft"`.
  - `firstJsonlObservedAt` holding a malformed non-empty string — not
    probed beyond empty-string/undefined. Acceptable: the server writes
    that field exclusively as `new Date().toISOString()`; a malformed
    value is not a reachable state.
- **Confidence-pattern check:** no "are you confident?"-style question
  produced a yes-then-finding in this run. The external review ran
  against the PLAN before build; its accepted findings were integrated
  pre-build, and the build's RED→GREEN cycle empirically verified each.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `cmd /c client\node_modules\.bin\playwright.cmd test
  --config=client/playwright.config.ts e2e/flows/<move-to-backlog-spec>`
  against a live dev stack (`BASE_URL`).
- **Evidence path:** `client/playwright-report/index.html` +
  `.shipwright/runs/iterate-2026-05-17-move-to-backlog/surface_verification.json`
- **Justification (only if surface=none):** n/a
