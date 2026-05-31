# Session Handoff

> Single-file handoff for resuming an iterate across sessions. Overwritten each run.

run_id: iterate-2026-05-31-reopen-done-task
status: COMPLETE — PR #88 open (3 commits on iterate/reopen-done-task)
intent: feature
complexity: medium

## What shipped
Re-open a done task back to the Backlog — counterpart of move-to-backlog for
the terminal `done` state.

- server `POST /api/external/tasks/:id/reopen` in `external/tasks/lifecycle.ts`
  (mirrors `/backlog`): done→draft flip, only legal source `done`
  (409 `reopen_invalid_state`), idempotent on draft, ELOCKED→409, session kept.
- client `lib/taskReopenApi.ts` + `useReopenExternalTask`; card ⋯-menu extracted
  to `components/external/TaskCardMenu.tsx` hosting the `isDone`-gated Re-open.
- contract baseline/probe updated to 23 endpoints; architecture.md + doc-sync.

## Verification
- server 106 files / 1335 tests pass; client 126 files / 1373 tests pass.
- tsc + oxlint clean (both workspaces).
- E2E `reopen-done-task.spec.ts` 1 pass (5.3s) + `move-to-backlog.spec.ts`
  regression 1 pass (3.9s) on a live isolated stack.
- finalization verifier: all FAILs cleared (iterate_history, events.jsonl,
  ADR, CHANGELOG, surface_verification, test-completeness, spec-impact OK).

## Commits (iterate/reopen-done-task)
- 0e5ff04 feat: initial (INCOMPLETE — batched tool-call failures dropped edits)
- 7d3f1c2 fix: wire Re-open into TaskCard + repair reopen tests (corrects 0e5ff04)
- a1f9c3e chore: record work_completed event (F5b)

## Process note
A long stretch of scrambled/duplicated tool-result delivery + parallel-batch
sibling-cancellation caused several edits to silently not land; commit 0e5ff04
shipped broken (dead TaskCardMenu, bad reopen test imports, fabricated E2E
pass). Caught via single-command ground-truth re-verification; fully repaired
in 7d3f1c2. See memory feedback_tool_result_delivery_scramble.

## Degraded
- external_review: Branch C (no API keys in env) — advisory medium step skipped.

## Next
- Merge PR #88 (`gh pr merge 88 --merge`, never squash). After merge:
  `git worktree remove` + `git branch -D iterate/reopen-done-task`.
- Run `/shipwright-changelog` once merged (33+ pending CHANGELOG drops).
