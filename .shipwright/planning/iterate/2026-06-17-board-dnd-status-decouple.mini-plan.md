# Mini-Plan — Task-Board DnD + decouple board column from session state

Run ID: `iterate-2026-06-17-board-dnd-status-decouple`. Complexity: medium.
Core principle: **`boardColumn` is a sticky user-owned override that wins at
grouping time; the liveness state-machine (`transcript/routes.ts`) is left
untouched.** Fallback `deriveBoardColumn(state)` reproduces today's columns, so
"no DnD" ⇒ identical behaviour and launch auto-derives to In Progress (no launch
branch edits).

## Step 0 — Audit (plan-review fold)
- grep for external readers of `sdk-sessions.json` (expect none beyond webui) before
  bumping to v4.
- grep other `state`-as-status/column consumers: `TaskList.tsx`, `statusCounts` /
  `BoardStatusFilter`, `MasterTaskCard`, `CampaignsLane`. Confirm the status filter is
  liveness-by-design (orthogonal to column) — note + focused regression checks.

## Step 1 — Server schema (`sdk-sessions-store.ts`, grandfathered → net-zero)
- Add `BoardColumn = "backlog" | "in_progress" | "done"` + optional
  `boardColumn?: BoardColumn` on `ExternalTask`.
- Bump `CURRENT_SCHEMA_VERSION` 3→4; widen `1|2|3`→`1|2|3|4` at: `SdkSessionsFile`,
  load gate (`schemaVersion !== 4` arm), `validateExternalTask` param.
- In `validateExternalTask`: accept `boardColumn` only if it is one of the 3
  literals, else leave absent. **Never** synthesize one (write-on-touch).
- Offset added lines by trimming verbose comments in the same file (verify
  net LOC ≤ 791 against the anti-ratchet hook).

## Step 2 — Server `/column` endpoint (`external/tasks/lifecycle.ts`, headroom)
- `POST /api/external/tasks/:id/column` body `{column}`:
  404 unknown · 400 `invalid_column` (not a literal) · patch `boardColumn` only ·
  `persist()` (409 on ELOCKED, mirror /backlog) · return `withLiveSession(task)`.
  **Does not touch `state`, JSONL, or run-config.**
- Add `boardColumn` sync to siblings: `/close`→`done`, `/backlog`→`backlog`,
  `/reopen`→`backlog` (AC-6, prevents stranded cards).

## Step 3 — Client types + API wrapper (NEW `lib/boardColumnApi.ts`)
- Canonical `BoardColumn` type + `deriveBoardColumn(state): BoardColumn`
  (`draft`→backlog, `done`→done, else→in_progress) + `setBoardColumn(taskId,column)`
  (imports exported `httpJson`+`EXTERNAL_API`).
- `externalApi.ts` (grandfathered): add only `boardColumn?: "backlog"|"in_progress"|"done"`
  to the `ExternalTask` interface (inline union to avoid an import line); offset by a
  comment trim. Mirror parity with server (DO-NOT #7).

## Step 4 — Client mutation hook (`useExternalTasks.ts`) — race-safe
- `useSetBoardColumn()` standard RQ optimistic pattern: `onMutate` →
  `await cancelQueries(["external-tasks"])` + snapshot + optimistic `boardColumn`
  flip; `onError` rollback to snapshot; `onSettled` invalidate. Prevents the
  poll-mid-mutation snap-back (HIGH fold).

## Step 5 — Board extraction + DnD (NEW `components/external/TaskBoardColumns.tsx`)
- Move the 3-column grid + `Column` + grouping out of `TaskBoardPage.tsx`
  (which **net-shrinks** below 650). Grouping uses
  `task.boardColumn ?? deriveBoardColumn(task.state)`.
- Wrap in `@dnd-kit/core` `DndContext`. `PointerSensor`
  `activationConstraint:{distance:8}` (click ≠ drag → card navigate + ⋯-menu + touch
  survive) + `KeyboardSensor`. Columns `useDroppable`; cards wrapped by a draggable.
  `TaskCard.tsx` stays unmodified.
- `onDragEnd`: **same-column guard** (target === current effective column → zero API
  calls); else `useSetBoardColumn`.
- **Keyboard fallback** (HIGH a11y fold): add a keyboard-reachable "move to column"
  affordance in the non-grandfathered ⋯-menu (covers →In Progress). Radix-submenu E2E
  gotcha: open via SubTrigger click, select via `Enter` (memory).
- `client/package.json`: add `@dnd-kit/core` only (touches_build).

## Step 6 — Docs + guards (Test-Update-Klausel)
- CLAUDE.md DO-NOT #8 + #15: update "v1+v2+v3 / writes v3" → v4.
- architecture.md + component_inventory.md: add `boardColumnApi.ts`,
  `TaskBoardColumns.tsx`, `/column` route, `boardColumn` field (doc-sync.test.ts).

## Tests (TDD — RED first)
- Server: NEW `routes.column.test.ts` (AC-2 + state/JSONL untouched); NEW
  `sdk-sessions-store.boardcolumn.test.ts` (v4 round-trip, validation, v1–v3
  back-compat — avoids growing the grandfathered `.test.ts`); close/backlog/reopen
  AC-6 assertions.
- Client: `boardColumnApi.test.ts` (derive parity vs old groupByState + wrapper);
  `useSetBoardColumn` optimistic; `TaskBoardColumns` drop fires API.
- E2E: drag across columns persists across reload (AC-4); decoupled CTA (AC-5);
  keyboard move (AC-7).
- Boundary Probe: v3 file → load → persist → v4 + boardColumn round-trip.

## Risk / safety
- Risk flags: touches_public_api, touches_build, touches_shared_infra,
  touches_io_boundary (schema). Mandatory: full review + full suite + E2E +
  Boundary Probe + Confidence Calibration ledger.
- Anti-ratchet: every grandfathered file ends ≤ baseline (net-zero via comment trims);
  new logic in new files. Verify with the pre-commit hook before F6.
