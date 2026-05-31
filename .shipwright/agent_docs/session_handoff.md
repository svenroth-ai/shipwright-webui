---
canon_generated: true
run_id: "iterate-2026-05-31-reopen-done-task"
phase: "iterate"
reason: "Re-open done task iterate complete — finalization verified 8 OK / 0 errors"
timestamp: "2026-05-31T14:00:00.000000+00:00"
---

# Session Handoff

run_id: iterate-2026-05-31-reopen-done-task
status: COMPLETE — PR #88 open (7 commits on iterate/reopen-done-task)
intent: feature · complexity: medium · spec_impact: ADD

## What shipped
Re-open a done task back to the Backlog — counterpart of move-to-backlog for
the terminal `done` state.

- server `POST /api/external/tasks/:id/reopen` in `external/tasks/lifecycle.ts`
  (mirrors `/backlog`): done→draft flip, only legal source `done`
  (409 `reopen_invalid_state`), idempotent on draft, ELOCKED→409, session kept.
- client `lib/taskReopenApi.ts` + `useReopenExternalTask`; the card ⋯-menu was
  extracted to `components/external/TaskCardMenu.tsx` hosting the
  `isDone`-gated "Re-open" item.
- contract baseline/probe → 23 endpoints; spec FR-01.01 AC; architecture.md;
  doc-sync tokens.

## Verification
- server 106 files / 1346 tests pass; client 127 files / 1379 tests pass.
- tsc + oxlint clean (both workspaces).
- E2E `reopen-done-task.spec.ts` pass + `move-to-backlog.spec.ts` regression
  pass on a live isolated stack (Hono :3859 + Vite :5189 local-profile).
- `verify_iterate_finalization.py`: **8 OK, 1 WARN (handoff age), 0 errors.**

## Commits (iterate/reopen-done-task)
- 0e5ff04 feat: initial (INCOMPLETE — batched tool-call failures dropped edits)
- 1dc5885 fix: wire Re-open into TaskCard + repair tests & E2E
- dbf53b9 chore: record work_completed event (F5b)
- 8470a2d chore: finalization artifacts (F5c + compliance regen)
- 471f62e chore: test_completeness.summary → counts (verifier)
- 76e9c50 chore: canonical changelog drop filename (_001.md)
- 7600526 docs(spec): FR-01.01 re-open AC (spec impact = ADD)

## Process note
A long stretch of scrambled/duplicated tool-result delivery + parallel-batch
sibling-cancellation caused many edits to silently not land; commit 0e5ff04
shipped broken (dead TaskCardMenu, bad reopen-test imports, fabricated E2E
pass). Caught via single-command ground-truth re-verification; fully repaired.
See memory feedback_tool_result_delivery_scramble +
feedback_webui_e2e_isolated_stack_recipe.

## Degraded
- external_review: Branch C (no API keys in env) — advisory medium step skipped.

## Next
- Merge PR #88 (`gh pr merge 88 --merge`, never squash). After merge:
  `git worktree remove .worktrees/reopen-done-task` + `git branch -D iterate/reopen-done-task`.
- Run `/shipwright-changelog` once merged (CHANGELOG drops pending aggregation).
