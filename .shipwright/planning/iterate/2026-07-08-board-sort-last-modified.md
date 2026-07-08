---
run_id: iterate-2026-07-08-board-sort-last-modified
date: 2026-07-08
intent: change
complexity: medium
status: implemented
affected_frs: [FR-01.01]
spec_impact: modify
---

# Board + List default sort → Last Modified (descending)

## Problem

The user cannot tell how the Task Board and List view are ordered:

- **Board view** (`TaskBoardColumns`): cards within each column render in
  whatever order the server returns them (`groupByColumn` pushes in array
  order). There is **no** explicit within-column sort, so the order looks
  arbitrary and shuffles as the 2 s poll re-fetches.
- **List view** (`TaskList`): already defaults to the "Updated" column
  descending, but it owns a *private* copy of the "last modified" definition
  (`lastActivityMs`) — a drift hazard.

## Goal

Make the **default ordering deterministic and consistent** across both views:
newest-activity task on top (Last-Modified, descending). One shared definition
of "last modified" feeds both views. Must be correct on **Desktop, Tablet, and
Phone** — which it is by construction, because the sort runs in the data layer
(before any responsive CSS breakpoint decides the layout).

## Scope

IN:
- New `client/src/lib/taskSort.ts` — canonical `taskLastModifiedMs(task)` +
  `compareTasksByLastModifiedDesc(a, b)` + `sortTasksByLastModifiedDesc(tasks)`,
  with a deterministic `taskId` tiebreak so equal timestamps never shuffle.
- Board: sort each column by Last-Modified-desc (via the shared helper).
- List: dedupe onto the shared helper; default order is unchanged
  (Updated-desc), the asc/desc + Title toggles keep working.

OUT (deferred — user: "wenn too much, mach einfach mal den Default"):
- A new sort-control / sort-icon on the **board** header. The List already has
  clickable sortable headers (Title / Updated); the board keeps its status
  pills. Revisit only if the default proves insufficient.
- MasterTaskCard child phase-tasks (ordered by pipeline phase by design) and
  the Campaigns lane (not tasks). Both out of scope.

## Definition of "Last Modified"

Verbatim the existing List-view precedence chain, now shared:

```
task.lastJsonlSeenMtimeMs   // live transcript activity (best signal)
  ?? launchedAt (ms)         // launched but no JSONL seen yet
  ?? createdAt (ms)          // never launched (draft)
  ?? 0                       // defensive floor
```

Descending = newest first. Ties broken by `taskId` (ascending) so the order is
byte-stable across re-renders / polls.

## Acceptance Criteria (assertion-shaped)

- **AC-1-agent** — Board: given tasks A (mtime older) and B (mtime newer) in the
  same column, B's card (`task-card-B`) appears **before** A's card
  (`task-card-A`) in DOM order within that column. Verified by a component
  render test asserting DOM order + a Playwright E2E asserting the first card in
  a column is the most-recently-active task.
- **AC-2-agent** — List: the first `task-list-row-*` (default sort, no header
  click) is the task with the greatest `lastModifiedMs`; clicking the "Updated"
  header toggles to ascending (oldest first). Verified by a component test.
- **AC-3-agent** — Consistency: for the same task set, the top-of-column order on
  the board equals the List default order filtered to that column (both use
  `compareTasksByLastModifiedDesc`). Verified by a unit test on the shared
  comparator (same input → same order).
- **AC-4-agent** — Determinism: two tasks with **equal** `lastModifiedMs` sort by
  `taskId` ascending and never swap across repeated sorts. Verified by a unit
  test.
- **AC-5-agent** — Device parity: the board renders the same sorted order at
  Desktop (1280), Tablet (834), and Phone (390) widths (the sort is
  layout-independent). Verified by a Playwright E2E that sets the three
  viewports and asserts the first card id in the In-Progress column is stable.
- **AC-1-user** (optional UAT) — On the real board, the most-recently-touched
  task visibly sits at the top of its column; refreshing/polling no longer
  reshuffles cards.

## Verification (medium+)

- **Surface:** web (UI-only change; no backend/API touched).
- **Runner:** Playwright (`client/e2e/`) against an isolated dev stack, plus
  Vitest component/unit tests.
- **Evidence path:** `shipwright_test_results.json.iterate_latest.surface_verification`.

## Confidence Calibration

- **Boundaries touched:** none. Pure client render-order; no env/config/JSON IO,
  no schema, no server route (`touches_io_boundary` = false, no risk flags).
- **Empirical probes run:**
  - *Unit determinism probe* — `taskSort.test.ts` (12 cases): precedence chain,
    non-finite mtime / unparseable ISO never poison the comparator, `taskId`
    tiebreak stable across input permutations, `sortTasksByLastModifiedDesc`
    non-mutating. Result: 12/12 pass.
  - *E2E order probe (3 viewports)* — `surface_verification.py` web, exit 0,
    1 spec: seeded 3 drafts (≥1 s apart) and asserted Backlog + List show them
    newest-first, identically, at Desktop 1280 / Tablet 834 / Phone 390, plus
    the List "Updated" toggle → oldest-first. Result: 1 passed.
  - *Regression probe* — full client suite 1900/1900, `tsc --noEmit` clean,
    `oxlint` clean on all changed files.
- **Test Completeness Ledger:** every behavior below is `tested`; zero
  untested-testable, zero `untestable` rows (nothing requires a prod
  credential / device / manual judgment). Enumeration basis = the 4 shared-helper
  behaviors + board ordering + list ordering + parity + device parity.

  | # | Behavior | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `taskLastModifiedMs` precedence mtime→launchedAt→createdAt→0 | tested | taskSort.test.ts "precedence chain" (4) |
  | 2 | non-finite mtime / unparseable ISO → skip, finite floor | tested | taskSort.test.ts "defensive" (3) |
  | 3 | `compareTasksByLastModifiedDesc` newest-first + taskId tiebreak | tested | taskSort.test.ts "order + determinism" (3) |
  | 4 | `sortTasksByLastModifiedDesc` non-mutating + mixed-source order | tested | taskSort.test.ts "immutability" (2) |
  | 5 | Board within-column newest-first | tested | TaskBoardColumns.test.tsx AC-1 + E2E |
  | 6 | Board equal-timestamp tiebreak | tested | TaskBoardColumns.test.tsx AC-4 |
  | 7 | List default order newest-first | tested | TaskList.test.tsx AC-2 + E2E |
  | 8 | List "Updated" toggle → oldest-first | tested | TaskList.test.tsx AC-2 + E2E toggle |
  | 9 | List equal-timestamp tiebreak | tested | TaskList.test.tsx AC-4 |
  | 10 | Board ↔ List order parity (same fixture) | tested | sortParity.test.tsx AC-3 |
  | 11 | Device parity Desktop/Tablet/Phone | tested | E2E 3-viewport loop (AC-5) |
  | 12 | List/Card "Updated" display unchanged after dedupe | tested | existing TaskList/TaskCard suites still green |
  | 13 | Board memoized sort (perf, behavior-preserving) | tested | existing grouping/decouple tests still green |

- **Confidence-pattern check:**
  - *Asymptote (depth):* the ordering is a pure function pinned at three levels
    — unit (precedence/NaN/tiebreak/immutability), component (actual DOM order in
    both surfaces + cross-surface parity), and E2E (real stack, 3 devices). No
    "should work" gaps.
  - *Coverage (breadth):* both views, default + toggle, ties, malformed
    timestamps, 3 viewports, and the TaskCard drift-copy migration are all
    exercised.
  - *Integration composition:* no `cross_component` machinery touched (diff is
    client components + one lib + tests + one E2E; no merge/hooks/pipeline/
    campaign files) → no `category:"integration"` behavior required.

## Post-implementation notes (review integration)

- External **plan** review (2/2 providers) + external **code** review (2/2) +
  one internal code-reviewer subagent. Verdict: ship (code-reviewer: "nothing
  material"; external code review: ship-with-fixes on E2E coverage — the flagged
  AC-2 toggle was added to the E2E).
- **Intentional, documented LOW behavior delta:** a *non-finite*
  `lastJsonlSeenMtimeMs` (NaN/Infinity) now falls through to `launchedAt` /
  `createdAt` for the "Updated" text, where the old code rendered "—". This
  value comes from `fs.stat().mtimeMs` server-side so it is effectively
  unreachable; the new behavior is strictly more correct and is what makes the
  *sort* robust (a NaN key would make `NaN - x` undefined). Conscious change.
- **Intentional:** in List *ascending* mode, equal-timestamp ties break by
  `taskId` descending (mirror of the desc default, because asc = reverse of
  desc). Fully deterministic; visible only on an exact-ms tie. Kept for
  simplicity — the default (desc, newest-first) is the byte-stable path.
