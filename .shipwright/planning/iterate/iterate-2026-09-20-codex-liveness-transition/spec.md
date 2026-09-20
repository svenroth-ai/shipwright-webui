# Iterate Spec — codex-liveness-transition

**run_id:** iterate-2026-09-20-codex-liveness-transition
**Intent:** BUG
**Complexity:** medium (self-escalated from classifier `small`)
**Spec Impact:** NONE — this restores behavior FR-01.74's own 4th AC
(`.shipwright/planning/01-adopted/spec.md` lines 1357-1365) already specifies:
a Codex-runtime task's stall/nudge/oracle classification is supposed to run
regardless of how the task was launched. The bug made that AC structurally
unreachable for every Codex launch flavor except `new-plain`; the fix
restores the AC's already-documented contract rather than changing it. No FR
row edit, no ADD/MODIFY/REMOVE.

## Problem

`ExternalTask.state` has exactly two paths out of `awaiting_external_start`:
JSONL-transcript polling (`transcript/routes.ts`, Claude-only by
construction — a Codex task has no Claude session/JSONL) and a WS-attach
pty-up flip (`ws-upgrade-handler.ts`) scoped to `actionId === "new-plain"`
only. Every Codex-runtime task launched via any other `actionId` — which is
the actual production usage (`new-iterate`, `resume`, `fork`,
`triage-promote`) — never leaves `awaiting_external_start`, which in turn
makes `CodexTaskWatcher`'s stall-nudge (`checkTask()`) unreachable for it.
Full root-cause trace: `bug-report.md` in this directory.

## Fix

Two sibling one-line guard widenings, same pattern, same conceptual edit:

1. `ws-upgrade-handler.ts` — the `awaiting_external_start → active` pty-up
   flip: `task.actionId === "new-plain"` →
   `task.actionId === "new-plain" || task.runtime === "codex"`.
2. `transcript/routes.ts` — the `active → idle` decay-on-pty-gone branch:
   same widening. Added after external review (GLM, `--mode iterate`, 2026-09-20)
   flagged that fix (1) alone makes `active` newly reachable for Codex tasks
   under non-`new-plain` actionIds, but without also widening the decay
   guard, such a task could never decay back to `idle` once its pty died —
   a known-inconsistent state left behind by a half-applied fix. Folded in
   rather than deferred since it is the same edit in the same conceptual
   area, directly unlocked by fix (1).

See `mini-plan.md` for the alternative considered and why this is the
minimal, lowest-risk option.

## Acceptance Criteria

1. A Codex-runtime task in `awaiting_external_start`, under ANY `actionId`
   (`new-plain`, `new-iterate`, `resume`, `fork`, `triage-promote`, …),
   transitions to `active` on the first WS attach (embedded-terminal open),
   exactly like the existing `new-plain` behavior does today.
2. A Claude-runtime task's behavior is byte-identical to pre-fix for every
   `actionId` — the `new-plain` exemption and the transcript-poll path for
   all other actionIds are untouched.
3. `firstJsonlObservedAt` is still never set by this code path, for either
   runtime — unchanged from today's `new-plain` semantics, and correct for
   Codex since no Claude JSONL will ever exist for it to observe later.
4. `CodexTaskWatcher.checkTask()`'s stall-nudge / oracle-classification
   branch becomes reachable (state no longer stuck at
   `awaiting_external_start`) for a Codex task launched via any actionId.

## Confidence Calibration

- **Confidence the root cause is correctly identified:** High. Traced through
  all three files that touch `ExternalTask.state` transitions
  end-to-end (write sites in `transcript/routes.ts` and
  `ws-upgrade-handler.ts`, read site in `codex-task-watcher.ts`), confirmed
  against live production evidence (`sdk-sessions.json` task
  `57a48b9a-e4d2-4c83-829b-13d58501696d`, stuck >15h, no
  `firstJsonlObservedAt`), and against a deterministic, code-level repro (not
  a race/flake) reproduced as a failing unit test before the fix.
- **Confidence the fix is complete (not just the reported case):** High. The
  fix keys on `task.runtime`, not on any specific `actionId`, so it covers
  every current and future actionId for the Codex runtime without needing a
  per-actionId allowlist — directly satisfying the explicit user requirement
  ("für jeden task ... nicht nur für iterate").
- **Confidence of no regression to Claude-runtime or existing new-plain
  behavior:** High. The added `|| task.runtime === "codex"` clause is
  a pure OR-widening — it cannot suppress the existing `new-plain` branch,
  and every existing regression test in `ws-upgrade-handler.test.ts`
  (including "does NOT flip for non-new-plain actionId", whose fixture
  default is `runtime: "claude"`) passes unmodified. Full server suite
  (4387 tests) green.
- **Residual risk:** external review (GLM, medium severity) flagged that
  headless/no-terminal Codex launches (an actionId that never opens a WS
  connection) would still never flip out of `awaiting_external_start` under
  this fix, since the flip trigger is WS-attach itself — AC-1's wording
  ("on the first WS attach") is satisfied, but the underlying "Codex has no
  non-WS liveness signal" gap persists for that specific launch shape. Not
  addressed here: no evidence any of the actionIds this fix targets
  (`new-iterate`, `resume`, `fork`, `triage-promote`) are ever launched
  headlessly in production (all open an embedded terminal), and inventing a
  second liveness mechanism for a hypothetical headless Codex launch would
  be exactly the scope creep the user's "not a second special case" framing
  warned against. Left for a future iterate if a real headless-Codex launch
  path is ever added.

External LLM review (`--mode iterate`, GLM + OpenAI, `driver=claude`): both
reviewers reached `approve` on round 3, after two `revise` rounds whose
concrete asks (show fix 2's diff, trace its reachability for Codex, name the
tests explicitly) are now incorporated into `mini-plan.md`. Full transcript:
`external-review-raw.json` in this run directory.

## Related work

Related: shipwright monorepo campaign `codex-plugin-execution-reliability`
(draft, not started) proposes an invocation-envelope mechanism
(`Spec/codex-plugin-execution-reliability.md` §1a Resolution B) that will
likely touch `launcher-codex.ts`/`buildCodexCommands` in this repo; whoever
plans that campaign's R0 should read this iterate's ADR entry for the
existing Codex-runtime liveness-signal precedent in `ws-upgrade-handler.ts`
before designing envelope delivery timing. That campaign covers a different
axis (Codex reliably *executing* Shipwright's skill/hook lifecycle as the
session driver) from this fix (the WebUI's bookkeeping of whether a Codex
task is alive) — no direct code overlap, no blocking dependency either way.
