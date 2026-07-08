---
run_id: iterate-2026-07-08-board-sort-last-modified
---

# Mini-Plan — Board + List default sort → Last Modified (desc)

## Files to create / modify

| File | Change | Notes |
|---|---|---|
| `client/src/lib/taskSort.ts` | **new** | Canonical last-modified helpers. ~40 LOC. |
| `client/src/lib/taskSort.test.ts` | **new** | Unit tests: precedence chain, desc order, `taskId` tiebreak determinism (AC-3, AC-4). |
| `client/src/components/external/TaskBoardColumns.tsx` | edit | `groupByColumn` sorts input via `sortTasksByLastModifiedDesc` before bucketing (AC-1). |
| `client/src/components/external/TaskBoardColumns.test.tsx` | edit | Add: within-column DOM order = newest first (AC-1). Existing grouping/decouple tests unchanged. |
| `client/src/components/external/TaskList.tsx` | edit | Replace private `lastActivityMs` with shared `taskLastModifiedMs`; `updated` sort uses `compareTasksByLastModifiedDesc` (default unchanged). |
| `client/src/components/external/TaskList.test.tsx` | edit | Add: default first row = newest; "Updated" click → oldest first (AC-2). |
| `client/e2e/<NN>-board-list-sort.spec.ts` | **new** | Board first-card-newest + 3-viewport parity (AC-1, AC-5). |
| `.shipwright/planning/01-adopted/spec.md` | edit | FR-01.01: append the default-ordering clause (spec_impact=modify). |

## Work breakdown (sequential, TDD)

1. **RED** — write `taskSort.test.ts` (comparator/precedence/tiebreak). Run → fails (module missing).
2. **GREEN** — implement `taskSort.ts`. Run unit → green.
3. **Board** — sort in `groupByColumn`; add the RED board-order test first, then wire. Run → green.
4. **List** — refactor onto shared helper; add the RED default-order test first, then wire. Run → green. Confirm no display regression (Updated cell still renders relative time).
5. **E2E** — author `client/e2e/NN-board-list-sort.spec.ts`; execute against the isolated stack at 1280/834/390 (AC-5).
6. **Spec** — FR-01.01 clause.
7. Full client `tsc` + `oxlint` + vitest; F0.5 surface_verification (web).

## Component hierarchy (unchanged)

`TaskBoardPage` → `TaskBoardColumns` → `DroppableColumn` → `DraggableCard` → `TaskCard`
`TaskBoardPage` → `TaskList` → `TaskListRow`

Only the **order** of the `items`/`sorted` arrays feeding the leaf lists changes.

## Data model changes

None. No new fields, no server change, no schema bump. `ExternalTask` already
carries `lastJsonlSeenMtimeMs` / `launchedAt` / `createdAt`.

## Test strategy

- Unit: `taskSort.test.ts` — comparator correctness + determinism (fast, pins AC-3/AC-4).
- Component: board within-column DOM order + list default order (AC-1/AC-2).
- E2E: board first-card + 3-viewport parity (AC-1/AC-5) — mandatory RUN at medium.

## Alternative approach (considered, rejected)

**Sort server-side** in the `/tasks` GET route so the client receives a
pre-sorted list. Rejected because: (a) the server list is consumed by multiple
clients/tabs and the List view still needs client-side re-sort for its Title /
asc toggle — server order would be immediately re-sorted anyway; (b) it couples
an organizational/presentation concern to the stateless read endpoint (rule 4 —
keep the transcript/list endpoints thin); (c) the board's within-column order is
a pure view concern. Client-side sort in a shared lib keeps the definition in
one place, testable in isolation, with zero backend risk. **Chosen: client-side
shared helper.**
