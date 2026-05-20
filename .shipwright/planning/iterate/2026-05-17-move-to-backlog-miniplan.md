# Mini-Plan: move-to-backlog

- **Run ID:** iterate-2026-05-17-move-to-backlog
- **Spec:** `.shipwright/planning/iterate/2026-05-17-move-to-backlog.md`

## Approach

Add a state-flip endpoint that mirrors the existing `POST .../close`
(FR-01.15) — a pure registry metadata flip, no JSONL / run-config touch.
Expose it through the client API + a TanStack mutation hook, and wire a
"Move to Backlog" item into both `…` menus (TaskCard, TaskDetailHeader).
Separately fix a pre-existing latent footgun: a `draft` task that has
already run (JSONL exists) must show **Resume**, not a fresh **Launch**.

## Alternative considered (and rejected)

**Extend `PATCH /api/external/tasks/:id` to accept `state`.** Rejected:
PATCH is deliberately metadata-only (`title` / `projectId`). Accepting a
free-form `state` would let a client set ANY state (`done`, `active`, …),
bypassing the launch/close state machine and the in-progress→draft
validation the user scoped. A dedicated verb-route with its own guard —
consistent with `/launch` and `/close` — is the safer shape.

## Work breakdown (files)

### Server

1. **`server/src/external/routes.ts`**
   - New `app.post("/api/external/tasks/:id/backlog", …)` placed next to
     `/close` (~L1414). Logic:
     - `404` if task missing.
     - `task.state === "draft"` → idempotent `200`, return task as-is.
     - `task.state === "done"` → `409 { error:"backlog_invalid_state",
       state }`.
     - else (the 5 in-progress states) → `store.patch(id,{state:"draft"})`,
       `await store.persist()` (ELOCKED → `409`), return
       `{ task: withLiveSession(...) }`. NO history field cleared.
   - Transcript-poll stickiness guard (~L1088): the `result==="missing"`
     branch `if (task.firstJsonlObservedAt && task.state !== "jsonl_missing")`
     gains `&& task.state !== "draft"` so a backlog task whose JSONL probe
     misses is not yanked to `jsonl_missing`. (The `result==="ok"` branch
     already has no transition out of `draft` — verified by reading the
     four `else if` arms; no change needed there.)

2. **`server/src/external/routes.backlog.test.ts`** (new) — endpoint +
   transcript-stickiness vitest tests.

### Client

3. **`client/src/lib/taskLifecycle.ts`** (new, tiny) — SSoT predicates
   shared by both surfaces to prevent drift:
   - `IN_PROGRESS_STATES` (the 5-state tuple)
   - `isInProgressState(state): boolean`
   - `hasLaunchedBefore(task): boolean` = `Boolean(task.firstJsonlObservedAt)`

4. **`client/src/lib/taskLifecycle.test.ts`** (new) — unit tests for the
   three predicates.

5. **`client/src/lib/externalApi.ts`** — `moveTaskToBacklog(taskId)`
   wrapper (mirrors `closeTask` — `POST .../backlog`).

6. **`client/src/hooks/useExternalTasks.ts`** — `useMoveTaskToBacklog()`
   mutation hook (mirrors `useCloseExternalTask` — `setQueryData` +
   `invalidateQueries(LIST_KEY)`).

7. **`client/src/components/external/TaskCard.tsx`**
   - Add a "Move to Backlog" `DropdownMenu.Item`, rendered only when
     `isInProgressState(task.state)`. No confirm dialog.
   - Launch/Resume fix: the `isBacklog` button branch renders the orange
     Resume button (`color="orange" resume={true}`) when
     `hasLaunchedBefore(task)`, else the green Launch (`resume={false}`).

8. **`client/src/components/external/TaskCard.test.tsx`** — menu-item
   visibility matrix; click → mutation; draft+JSONL → Resume button.

9. **`client/src/components/external/TaskDetailHeader.tsx`**
   - Add the same "Move to Backlog" `DropdownMenu.Item` (visibility =
     `isInProgressState`), placed in the state-action group near
     "Close task".
   - `ctaFor()` returns `"resume"` for a `draft` task when
     `hasLaunchedBefore(task)`, else `"launch"` (unchanged for non-draft).

10. **`client/src/components/external/TaskDetailHeader.test.tsx`** —
    menu-item visibility; `ctaFor` resume-for-draft+JSONL.

11. **`client/e2e/flows/<NN>-move-to-backlog.spec.ts`** (new) — E2E:
    move an in-progress task → assert it lands under `column-draft`.

## Test strategy

- **Unit (server):** `routes.backlog.test.ts` — `200` for each of the 5
  in-progress states; `409` for `done`; idempotent `200` for `draft`;
  `404` unknown id; history-fields-preserved assertion; transcript-poll
  stickiness (draft + `firstJsonlObservedAt` + JSONL-missing probe stays
  `draft`).
- **Unit (client):** `taskLifecycle.test.ts` predicates;
  `TaskCard.test.tsx` + `TaskDetailHeader.test.tsx` menu-visibility +
  Resume-rendering. Radix menu interactions use `userEvent.click`
  (jsdom — see conventions.md learning).
- **E2E:** one Playwright flow against the live dev stack.
- Full vitest suite at F0 (medium → full suite).

## Risk / regression notes

- `touches_public_api` → mandatory code review.
- DO-NOT #12: no `shipwright_run_config.json` write — the endpoint only
  patches `sdk-sessions.json`. Pipeline phase-task shadows can be moved to
  backlog; this relabels only the webui shadow and is documented as known
  drift in the ADR.
- DO-NOT #11: no hardcoded phase/`shipwright-` strings introduced.
- The Launch/Resume fix is keyed on `firstJsonlObservedAt` — the same
  signal `project_resume_newplain_needs_jsonl_check` already established
  as authoritative.

## External LLM Review integration (openrouter — gemini + openai, 16 findings)

**Accepted — folded into the plan:**

- **A1 (OpenAI HIGH #1) — explicit allowlist.** The server route uses an
  explicit 5-state allowlist constant, not a "not-`draft`/not-`done`"
  negation. Anything outside the allowlist (and not `draft`/`done`) →
  `409 backlog_invalid_state`. Self-documenting + future-state-safe.
- **A2 (OpenAI #2) — server owns its allowlist.** `BACKLOG_SOURCE_STATES`
  is defined server-side (the route's source of truth); the client
  `IN_PROGRESS_STATES` in `taskLifecycle.ts` is a verbatim mirror.
  Comment in each names the other (no cross-package import — DO-NOT #7).
- **A3 (OpenAI #3 / Gemini #2) — detail cache.** `useMoveTaskToBacklog`
  mirrors `useCloseExternalTask` EXACTLY — which already does
  `setQueryData(detailKey, task)` + `invalidateQueries(LIST_KEY)`. The
  `detailKey` write is what flips the TaskDetailHeader badge in place
  (AC-5). A test asserts the header updates post-mutation.
- **A4 (OpenAI #4) — transcript stickiness test covers BOTH branches.**
  `ok` and `missing` transcript polls against a `draft`+JSONL task; both
  assert `state` stays `draft`.
- **A5 (OpenAI #9) — deep-equality test.** A server test populates every
  history field (incl. object-shaped `inbox`) and asserts deep equality
  before/after except `state`.
- **A6 (OpenAI #12) — isolate the Resume/Launch fix.** Explicit
  regression test: an ordinary never-launched `draft` task
  (`firstJsonlObservedAt` unset) still shows the green Launch button.
- **A7 (OpenAI #8) — envelope parity.** Success `{ task }` and ELOCKED
  `409 { error }` envelopes mirror `/close` + the PATCH route exactly.

**Acknowledged — documented, no plan change (rationale for the ADR):**

- **Gemini HIGH #1 ("zombie" active processes).** Premise (webui owns /
  can kill the Claude process) is false for this architecture: webui
  spawns no Claude process (ADR-034, Plan-D''); `active` means "JSONL
  observed recently", not "webui controls a process". Moving `active` →
  backlog is a registry-only relabel. The Resume-on-live-session risk is
  PRE-EXISTING — resume-cta-rework (PR #29) already shows Resume
  unconditionally for `active`/`idle` — and bounded by Claude's own
  "Session ID already in use" rejection + the EmbeddedTerminal one-shot
  inject guard. The user explicitly scoped `active` in (the "exclude
  active" option was offered and not chosen). No kill signal, no
  exclusion.
- **OpenAI #10 (auth parity).** WebUI has no auth layer — loopback-only
  bind is the security model. `/backlog` has identical exposure to
  `/close` / `/launch` / `/delete`. Nothing to mirror.
- **OpenAI #11 (telemetry parity).** Sibling endpoints (`/close`) emit no
  structured logs/events. Parity = none.
- **Gemini #3 (infinite transcript polling).** Draft tasks are already
  transcript-polled today (status quo for every never-launched draft);
  not introduced by this change. Pausing the poll for `draft` is a
  separate optimization, out of scope.
- **Gemini #4 (retained error fields).** `ExternalTask` carries no
  error-string field — `launch_failed` is purely a `state` value. There
  is nothing stale to render once `state` becomes `draft`. (Verified
  against `client/src/lib/externalApi.ts`.)
- **OpenAI #5 (`firstJsonlObservedAt` malformed).** Low residual: the
  field is server-written exclusively as `new Date().toISOString()` (or
  undefined); `Boolean()` is correct for that shape. Noted in Confidence
  Calibration.
- **OpenAI #6 / #7 (race / board reorder).** Idempotent-`200` + mutation
  reconciling from the returned task payload handles the race;
  `groupByState` buckets purely by `state` with no separate sort, so a
  card relocates to `column-draft` by construction (E2E asserts it).
