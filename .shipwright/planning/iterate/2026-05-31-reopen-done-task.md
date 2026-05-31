# Iterate Spec — Re-open a done task

- **Run ID:** `iterate-2026-05-31-reopen-done-task`
- **Date:** 2026-05-31
- **Intent:** FEATURE (new lifecycle transition)
- **Complexity:** medium (classifier: small @0.75; bumped — cross-workspace,
  new public API route, backend-affects-frontend → E2E mandatory)
- **Risk flags:** `touches_public_api` (mandatory review)
- **Spec Impact:** ADD (new `/reopen` endpoint + a board menu affordance)
- **Counterpart of:** `iterate-2026-05-17-move-to-backlog` (In-Progress → draft)

## Problem

`done` is a terminal state on the task board with no path back. Once a user
marks a task done (via "Close (mark done)") they cannot return it to the board
to do more work. The move-to-backlog iterate added the In-Progress → draft
transition; this is its counterpart for the terminal state.

## Decision (Think Before Coding)

**Re-open = a pure registry-state flip `done → draft`, preserving every history
field (including `sessionUuid` + `firstJsonlObservedAt`).** Exactly mirrors the
`/backlog` handler. The user then **Resumes** (the card renders Resume, not a
fresh Launch, because `hasLaunchedBefore` is true) — continuing the completed
session.

Why `draft` is the target (the interview's pinned question):

1. The persisted task state is `ExternalTaskState`
   (`draft | awaiting_external_start | active | idle | jsonl_missing |
   launch_failed | done`). "In-Progress" is **not a single settable state** — it
   is the five-state bucket the board groups under one column. The only
   "back-on-the-board, ready to act again" state a re-open can target is
   `draft` (the Backlog column).
2. `done` is **only ever set explicitly** via `/close` (`store.patch(id,
   {state:"done"})`); it is never re-derived by the transcript poller. So a
   `done → draft` flip is sticky — the existing draft-stickiness path
   (`firstJsonlObservedAt` set) keeps the reopened card in the Backlog across
   polls, identical to a backlogged-after-running task. No new derivation code.
3. Unlike `/backlog`, the session binding is **kept** (not cleared): a done
   task's transcript is valuable and the user's intent on re-open is to
   continue, so the card offers Resume on the same `sessionUuid`.

**Alternative considered — clear the session (like a fresh start).** Rejected:
loses the completed transcript link and contradicts the "continue work" intent.
`/backlog` also keeps history (it is a pure state flip too); symmetry holds.

**Alternative considered — reuse generic `PATCH {state:"draft"}`.** Rejected:
PATCH does not validate the source state and is not the lifecycle-transition
surface; the dedicated `/reopen` endpoint mirrors `/backlog` (404 / 409 /
idempotent / ELOCKED branches) and is contract-tested.

## Scope (Surgical Changes)

Server:
- `external/tasks/lifecycle.ts` — `POST /api/external/tasks/:id/reopen`
  (registered inside `registerTasksLifecycle`). 404 `Task not found`;
  idempotent 200 when already draft; 409 `reopen_invalid_state` for any
  non-`done` source; ELOCKED → 409. Returns `{ task }` via `withLiveSession`.
- `external/tasks/routes.ts` — header route map line.
- `external/__tests__/api-contract-baseline.json` — `tasks.reopen` entry +
  `endpoint_count` 22 → 23.
- `external/__tests__/api-contract-probes.ts` — `tasks.reopen` 404 probe.

Client:
- `lib/taskReopenApi.ts` (NEW) — `reopenTask()` using the exported
  `httpJson` + `EXTERNAL_API` (externalApi.ts is at its bloat ceiling; the
  prStatusApi.ts split is the precedent).
- `hooks/useExternalTasks.ts` — `useReopenExternalTask` (mirrors
  `useMoveTaskToBacklog`: detail-cache write + list invalidation).
- `components/external/TaskCardMenu.tsx` (NEW) — the card ⋯-menu, **extracted**
  from TaskCard.tsx (606 lines, over the 300 guideline + at its grandfathered
  bloat baseline) so the new "Re-open" item fits without ratcheting. Re-open
  item gated by `isDone`. All testids preserved.
- `components/external/TaskCard.tsx` — render `<TaskCardMenu/>`; wire
  `useReopenExternalTask`; drop now-unused DropdownMenu/MoreHorizontal imports
  (net LOC decreases — safe against the ratchet).

Tests: `routes.reopen.test.ts`, `TaskCardMenu.test.tsx`, reopen block in
`TaskCard.test.tsx`, E2E `e2e/flows/reopen-done-task.spec.ts`.

Docs: `.shipwright/agent_docs/architecture.md` route map (F2).

## Acceptance Criteria

- **AC1** `POST /reopen` on a **done** task → 200, `state:"draft"`, session
  preserved.
- **AC2** Reopen on a **draft** task → 200 idempotent no-op.
- **AC3** Reopen on any **In-Progress** state → 409 `reopen_invalid_state`.
- **AC4** Reopen on a **missing** task → 404 `Task not found`.
- **AC5** Reopened (draft + `firstJsonlObservedAt`) task stays draft across
  transcript polls (stickiness).
- **AC6** UI: a **done** card shows an enabled "Re-open" item that POSTs
  `/reopen`; the item is absent for draft + In-Progress. Re-open relocates the
  card Done → Backlog (E2E).
- **AC7** Contract baseline ↔ probe parity stays green; full server/client
  suites + tsc + lint stay green.

## Confidence Calibration

- **Boundaries touched:** HTTP API (new `POST /reopen` + contract baseline);
  persisted task store mutation (`state` flip via `store.patch`); client
  fetch boundary (`taskReopenApi` → `/reopen`).
- **Empirical probes run:**
  - reopen happy/idempotent/409×5/404/ELOCKED/stickiness — `routes.reopen.test.ts` → **11 pass**
  - contract baseline ↔ probe parity + route discovery — `api-contract-sweep` → **44 pass**
  - menu gating + onReopen callback — `TaskCardMenu.test.tsx` → **4 pass**
  - TaskCard wiring (done shows Re-open; absent otherwise; click POSTs /reopen) — `TaskCard.test.tsx` → **35 pass**
  - full suites — server **1335 pass**, client **1014 pass**; `tsc` clean both; `oxlint` clean (changed files)
  - real-browser round-trip (create → close → Re-open → Done→Backlog, server state draft) — `e2e/flows/reopen-done-task.spec.ts` → **1 pass (4.1s)** on a live isolated stack
- **Test Completeness Ledger:** every AC + ELOCKED → `tested` with cited evidence; 0 testable-but-untested (machine-readable block in `shipwright_test_results.json.iterate_latest.test_completeness`).
- **Confidence-pattern check:** depth — each AC has happy + error probes;
  breadth — server policy + route + client unit + client integration + real
  E2E all covered.
