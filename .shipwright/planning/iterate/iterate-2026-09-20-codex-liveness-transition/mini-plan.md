# Mini-Plan — codex-liveness-transition

## Chosen approach: widen the `actionId === "new-plain"` guard to include `task.runtime === "codex"`

**Change:** `server/src/terminal/ws-upgrade-handler.ts`, the AC-4 pty-up flip
inside `onOpen`:

```diff
- if (task.state === "awaiting_external_start" && task.actionId === "new-plain") {
+ if (
+   task.state === "awaiting_external_start" &&
+   (task.actionId === "new-plain" || task.runtime === "codex")
+ ) {
```

**Why this is correct:** the flip's real precondition was never "this is a
new-plain task" — it was "no Claude JSONL will ever be written for this
task, so pty-up is the only liveness evidence it will ever produce." For
Claude runtime that precondition holds only for `new-plain`. For Codex
runtime it holds unconditionally (no `actionId` ever produces a Claude
JSONL, because there is no Claude session at all). `task.runtime === "codex"`
names the real precondition directly instead of enumerating every Codex
`actionId` as a second special case.

**Blast radius:** one file, one boolean expression, ~15 lines of updated
comments. No new dependency, no new state field, no schema change.

## Alternative considered: pty-activity signal via `PtyManager.getLastDataAt`/`attachCount`

Have `CodexTaskWatcher` (or a new watcher pass) itself flip
`awaiting_external_start → active` once `getLastDataAt(taskId)` returns
non-null and some minimal silence/data threshold has passed, instead of
doing it synchronously in the WS `onOpen` handler.

**Rejected because:**
1. `CodexTaskWatcher.checkTask()` already returns early for
   `awaiting_external_start` specifically to avoid running the (expensive,
   subprocess-spawning) completion-oracle before a task is even confirmed
   alive — see its own `§5.2 launch-confirmation timeout` comment. Moving
   the flip into the watcher means either weakening that early-return (so
   the oracle could fire before the task is even up, wasteful and possibly
   wrong) or adding a THIRD state-transition mechanism alongside the two
   that already exist, which is exactly the kind of "second special case
   bolted on" the user explicitly asked NOT to build.
2. The watcher ticks every 60s (`index.ts`), so this would add up to a 60s
   detection lag for a transition that the existing `new-plain` mechanism
   already does synchronously at WS-attach time — a regression in latency
   for no benefit, since the WS attach IS the pty-activity signal (a pty
   only exists/streams once something is attached and spawned).
3. It does not reuse the existing, already-reviewed AC-4 mechanism — it
   duplicates its intent through a different code path, doubling the
   surface a future reader has to reconcile ("why are there two ways a
   Codex task becomes active?").

`codex-thread-discovery.ts`'s threadId discovery was also considered as a
signal (a task becomes "active" once a threadId is discovered) but rejected
for the same reasons plus a correctness gap: thread discovery can be
delayed or fail to match (see its own de-dup/claim logic in
`codex-task-watcher.ts` `tick()`), which would make "active" depend on a
best-effort heuristic instead of the much stronger and always-available
"a WS actually attached to this task's pty" signal.

## Fix 1 tests — the primary `awaiting_external_start → active` transition

(External review round 3, OpenAI, medium: asked these be enumerated
explicitly rather than left implicit.) Added to
`server/src/terminal/ws-upgrade-handler.test.ts`,
`describe("buildWsHandlers — Codex-runtime state flip")`:

1. `flips awaiting_external_start → active for a Codex task under a
   non-new-plain actionId (new-iterate)` — the primary reported-defect case.
2. `flips awaiting_external_start → active for a Codex task under
   resume/fork actionIds too` — loops `["resume", "fork", "triage-promote"]`,
   directly proving the "every actionId" requirement, not just one example.
3. `does NOT flip a Claude-runtime task under a non-new-plain actionId
   (regression guard)` — `runtime: "claude"` stays inert under the new clause.
4. `does NOT set firstJsonlObservedAt when flipping a Codex task` — pins the
   unchanged side-effect semantics.
5. `does NOT flip a Codex task when state is already active` — idempotency,
   mirrors the existing new-plain idempotency test.

## Fix 2 diff — the paired `active → idle` decay widening

External review (GLM + OpenAI, `--mode iterate`, round 1) correctly flagged
that this document described fix 2 in prose only, with no diff and no
explicit reachability trace for Codex. Both raised the same concern: **is
`transcript/routes.ts`'s pty-gone decay branch even reached for a Codex
task**, given the file's own framing is Claude/JSONL-oriented?

**Reachability, traced and confirmed (not asserted):** the client's poller
(`client/src/hooks/useTaskTranscript.ts`, `useTaskTranscript()`) calls
`GET /api/external/tasks/:id/transcript` unconditionally every 1s for ANY
`taskId`, with no `runtime` check anywhere in the hook — it stops polling
only on `state === "done" || "launch_failed"`. Server-side,
`watcher.readChunk()` returns `{status: "missing"}` whenever no `.jsonl`
exists for `task.sessionUuid` under `~/.claude/projects/` — which is
**always** true for a Codex-runtime task, by construction (no Claude session
backs it). So the `result.status === "missing"` branch — the one containing
the decay-on-pty-gone check — fires on **every single poll** for a Codex
task, at the same 1s cadence as for a Claude `new-plain` task. Reachability
confirmed, not assumed.

**Diff:**

```diff
       } else if (
         // iterate-2026-05-08 v0.8.7 AC-1 — `new-plain` tasks never write
         // JSONL (per known_issues.md). Without this branch, AC-4's pty-up
         // active-state never decays back to `idle` after pty-kill, so the
         // header CTA stays empty (Resume only renders for state=idle).
-        task.actionId === "new-plain" &&
+        //
+        // iterate-2026-09-20-codex-liveness-transition — same gap, same
+        // reason, for the Codex runtime (see mini-plan.md's reachability
+        // trace: this branch fires on every poll for a Codex task, since
+        // `watcher.readChunk()` always reports "missing" for it).
+        (task.actionId === "new-plain" || task.runtime === "codex") &&
         task.state === "active" &&
         ptyManager.get(task.taskId) === undefined
       ) {
         store.patch(task.taskId, { state: "idle" });
         await store.persist();
       }
```

**Tests added** (`server/src/external/routes.transcript-newplain-idle.test.ts`,
new `describe("Codex-runtime — transcript poll patches ...")` block):
1. `patches codex + active + no-pty to "idle", under a non-new-plain
   actionId` — proves fix (2)'s positive case end-to-end through the real
   Hono route (not a unit-level guard check), using `actionId: "new-iterate"`.
2. `does NOT patch a claude-runtime task under a non-new-plain actionId
   (regression guard)` — directly answers both reviewers' "high"/"medium"
   findings: a Claude task under a non-`new-plain` actionId (e.g.
   `new-iterate`) with `state: "active"` and no live pty stays `active`,
   unchanged from pre-fix — the added clause is inert for `runtime !== "codex"`.

## Internal Plan Review

Both approaches solve the reported symptom. The chosen approach:
- reuses the exact mechanism (`ws-upgrade-handler.ts` AC-4 flip) the
  codebase already has, reviewed, and tested for the identical problem on
  the Claude side — same trigger (WS attach), same non-side-effect
  (`firstJsonlObservedAt` left unset), same state transition;
- is provably a pure widening (`||`) of an existing condition, so every
  existing Claude/new-plain regression test is a structural guarantee of
  no regression, not just an empirical one;
- has zero latency cost (synchronous at attach, not tied to the 60s watcher
  tick);
- directly satisfies the user's explicit requirement to generalize across
  every actionId, since `task.runtime` doesn't enumerate actionIds at all.

No footguns identified: the WS-attach handler is a protected deep module
(ADR-103) but this change touches none of its three shared locks (writer-slot,
pause-refcount, attach-count) — it sits entirely inside the pre-existing
AC-4 conditional, before any of that machinery runs.
