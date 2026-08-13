# Self-Review — iterate-2026-08-13-task-description-length-cap

1. **Root cause pinned, not a symptom patch.** `DESCRIPTION_MAX_LENGTH` was
   20,000 — far above the ~8,191-char Windows interactive console line
   limit the launch command actually hits (`{task.initial_prompt}` in
   `core/actions-substitute.ts`, written to the pty in one WS data-frame by
   `useAutoLaunch.ts`). Lowered to 6,000 with a comment explaining why.
2. **All three entry points covered.** Manual create (`external/tasks/
   create.ts`), edit (`external/tasks/patch.ts`) — both already funneled
   through `normalizeDescription()`, so the lower constant alone fixes
   them. Triage-promote (`routes/triage.ts`) used to silently truncate;
   changed to reject with the same `invalid_description` 400 shape as
   create/edit, so all three surfaces now behave identically.
3. **No duplicated constant.** `triage.ts`'s hand-mirrored copy of
   `DESCRIPTION_MAX_LENGTH` is gone; it now imports the real one from
   `external/_shared/helpers.ts`, closing the drift risk the removed
   comment used to warn about.
4. **Tests pin both the boundary and the rejection, not just presence of
   an error.** Create/edit/promote each have an at-cap (6,000, accepted)
   and over-cap (6,001, rejected with the exact message) test — no
   truncation-only assertions remain anywhere.
5. **Affected boundaries:** `server/src/external/_shared/helpers.ts`
   (constant), `server/src/routes/triage.ts` (promote route), two client
   textareas (`NewIssueModal/SimpleFields.tsx`, `EditTaskModal.tsx`).
   Verified the client `maxLength` mirrors the server constant with a
   comment cross-referencing it, rather than an independent magic number.
6. **Full suite green.** Server: 289 files / 3,359 passed + 1 pre-existing
   skip. Client: 352 files / 3,312 passed. `tsc --noEmit` clean both
   workspaces. `oxlint` clean on every touched file.
7. **Bloat baseline:** `EditTaskModal.tsx` grew 439→445 LOC (already
   grandfathered over the 300 limit); baseline `current`/`adr` updated in
   the same commit rather than silently ratcheting. `routes.edit-fields.
   test.ts` stayed net-negative by extracting its shared harness to
   `_routes-edit-fields-harness.ts` (also lets the new
   `routes.description-length-cap.test.ts` reuse it) instead of growing
   past its own baseline.
8. **Out of scope, by explicit user decision:** the deeper two-stage
   launch-dispatch fix (short shell command, then write the description
   directly into Claude's own input box) and any change to the sibling
   `shipwright` monorepo — a separate triage card (`trg-496b35ba`) was
   filed there instead, proposing a `maxLength` on the general triage
   `detail` schema field.
