# Bug Report — F-debug (systematic-debugging protocol)

**run_id:** iterate-2026-09-20-codex-liveness-transition
**Complexity:** medium (self-escalated from classifier `small`; touched files
are documented deep/protected modules with app-wide blast radius —
`ws-upgrade-handler.ts` is ADR-103's protected deep module, `codex-task-watcher.ts`
is the Codex Light §5.1 heartbeat).

## Phase 1 — Read Error

No stack trace / exception — this is a stuck-state bug surfaced by the
operator ("codex läuft im worktree (e2e...), aber ich glaube der heartbeat
macht nichts"). Observed vs. expected:

- **Observed:** a live Codex-runtime task (`57a48b9a-e4d2-4c83-829b-13d58501696d`,
  `actionId: "new-iterate"`, `run_id: iterate-2026-09-19-e2e-journey-coverage-gate`)
  sits in `state: "awaiting_external_start"` for >15h in
  `~/.shipwright-webui/sdk-sessions.json`, with no `firstJsonlObservedAt`, and
  `CodexTaskWatcher`'s stall-nudge never fires despite the pty being silent
  well past the default 15-minute stall timeout.
- **Expected (FR-01.74, 4th AC, `.shipwright/planning/01-adopted/spec.md`
  lines 1357-1365):** "Given a Codex-runtime task's terminal has produced no
  output for longer than the stall timeout, when the completion-oracle check
  runs, then it classifies the session as done / probably still working
  (nudge) / waiting on PR delivery / no automated check available."

## Phase 2 — Reproduce

Deterministic, code-level repro (no flakiness — a structural gap, not a race):

1. Launch any task with `runtime: "codex"` and `actionId` anything other than
   `"new-plain"` (i.e. `"new-iterate"`, `"resume"`, `"fork"`,
   `"triage-promote"` — the actual production launch paths for Codex).
2. Task is created in `state: "awaiting_external_start"`.
3. The WS upgrade for the embedded terminal attaches (pty comes up, Codex
   produces output) — confirmed via `server/src/terminal/ws-upgrade-handler.ts`
   `onOpen`, which is the ONLY non-JSONL-poll transition path.
4. The state-flip guard at (pre-fix) lines 465-468 only fires when
   `task.actionId === "new-plain"`. For any other `actionId`, nothing patches
   the state — it stays `awaiting_external_start` indefinitely.
5. Separately, `server/src/external/transcript/routes.ts`'s poll-driven
   transition is the ONLY other path out of `awaiting_external_start` — but
   it depends on Claude's `.jsonl` transcript file existing under
   `~/.claude/projects/`. A Codex-runtime task has no Claude session at all,
   so this path can never fire for it, under any `actionId`.
6. Result: state is permanently stuck. `CodexTaskWatcher.checkTask()`
   (`server/src/core/codex-task-watcher.ts` line 187) returns early whenever
   `task.state === "awaiting_external_start"`, after only checking the 90s
   launch-confirmation timeout — so the stall-nudge logic below it
   (lines 201-284) is unreachable for the entire lifetime of the bug.

Confirmed against a unit-test reproduction added in this iterate
(`server/src/terminal/ws-upgrade-handler.test.ts`, describe block "Codex-runtime
state flip" — see the two new failing-before/passing-after cases).

## Phase 3 — Recent Changes

Not a regression in the sense of "code that used to work broke" — it is a
gap introduced the day the corresponding feature was added, never closed:

- `git log --oneline -- server/src/terminal/ws-upgrade-handler.ts` shows the
  `new-plain` flip landed as ADR-058 / "Iterate v0.8.5 AC-4" — well before
  Codex Light existed. AC-4's own comment explicitly reasons about "all other
  actionIds (slash-command launches; resume; fork)" being covered by the
  transcript-poll path — a correct claim **for Claude-runtime tasks**, which
  is the only runtime that existed at the time.
- `iterate-2026-09-16-codex-light-webui` (architecture.md line 216) added the
  Codex runtime axis and `CodexTaskWatcher`, but did not revisit AC-4's
  `actionId === "new-plain"` guard to account for the fact that its stated
  "transcript-poll path remains authoritative for all other actionIds"
  premise silently stopped being true for the entire new `runtime: "codex"`
  axis — Codex was layered on top of a state machine whose only two
  transition paths both implicitly assumed a Claude JSONL existed somewhere.
- Conclusion: not a regression of previously-correct behavior; a coverage
  gap in the original Codex Light build that this iterate closes, consistent
  with FR-01.74's own 4th AC already specifying the intended behavior (Spec
  Impact: NONE — see the iterate spec).

## Phase 4 — Component-Boundary Instrumentation / Root Cause

Traced the value (`task.state`) from every write site to `CodexTaskWatcher`'s
read of it:

- Write site 1 (`transcript/routes.ts`): gated on `watcher.readChunk` finding
  a Claude JSONL — never true for `runtime: "codex"`.
- Write site 2 (`ws-upgrade-handler.ts` onOpen): gated on
  `task.actionId === "new-plain"` — true only for one specific Codex launch
  path (a plain new task), false for every other Codex launch path
  (iterate, triage-promote, fork, resume).
- Read site (`codex-task-watcher.ts` `checkTask()`): returns early for
  `state === "awaiting_external_start"`, so the stall-nudge machinery below
  is dead code for any task stuck in that state.

**Root-cause statement:** `ws-upgrade-handler.ts`'s pty-up liveness flip
checks `task.actionId === "new-plain"` — a condition that correctly
distinguishes "no Claude JSONL will ever exist for this specific launch
flavor" for the Claude runtime, but is the wrong discriminator for the Codex
runtime, where **no Claude JSONL ever exists for ANY launch flavor**; the
correct discriminator for "pty-up is the only liveness evidence this task
will ever produce" is `task.runtime === "codex"`, not `task.actionId`.

## Fix

`ws-upgrade-handler.ts`'s flip condition widened from
`task.actionId === "new-plain"` to
`task.actionId === "new-plain" || task.runtime === "codex"`. Claude-runtime
behavior (any actionId) and the existing new-plain/Claude regression fixture
are provably unchanged (see the pre-existing "does NOT flip for non-new-plain
actionId" test, which uses the fixture default `runtime: "claude"` and still
passes unmodified). `firstJsonlObservedAt` is still never set on this path —
correct for Codex, since no Claude JSONL will ever exist to observe.

Failing-before/passing-after test:
`server/src/terminal/ws-upgrade-handler.test.ts` → "buildWsHandlers — Codex-runtime state flip"
→ "flips awaiting_external_start → active for a Codex task under a non-new-plain actionId (new-iterate)".
