# ADR: fix two Codex-runtime launch-prompt bugs — empty `phase` on triage-promote, unprefixed SKILL.md path

- **Run ID:** iterate-2026-09-19-codex-launch-phase-empty
- **Date:** 2026-09-19
- **Status:** accepted

## Context

Sven reported that a Codex session he launched from a triage-promoted task
did not create a worktree cleanly and executed the iterate skill "pick and
choose" instead of running its full mandatory lifecycle. The initial
hypothesis — that Codex structurally ignores Shipwright's prose-based skill
instructions — was investigated with a delegated Opus adversarial review
that read the session's actual `~/.codex/sessions/**/rollout-*.jsonl`
transcript. That review **falsified** the hypothesis: the worktree was
created correctly on the first launch; the observed symptom was a
misdiagnosed relaunch into an already-existing worktree.

The same review surfaced the real, much smaller bug: `buildCodexPrompt()`
(`server/src/core/launcher-codex.ts`) only emits its
"Read `<path>`/SKILL.md and execute it" instruction line when `phase` is
present on the launch args, and the triage-promote handler
(`server/src/routes/triage.ts`) never set `phase` on the task it created —
`store.create({...})` passed `actionId: "new-iterate"` but no `phase`.
A Codex-runtime task promoted from triage therefore launched with no
explicit instruction to run the iterate skill at all, unless the target
project's `AGENTS.md` happened to cover the iterate phase.

A second, independent bug was found in the same code path: the SKILL.md
pointer template read `Read shipwright-${phase}/skills/${phase}/SKILL.md`,
but the real monorepo/plugin-cache layout is
`plugins/shipwright-${phase}/skills/${phase}/SKILL.md` — the unprefixed
form is not a resolvable path from a project root or a Codex plugin cache,
regardless of whether `phase` is set. This bug was latent for the common
`phase === "iterate"` + `AGENTS.md`-present case (the pointer line is
suppressed entirely there) but would have broken every other phase/project
combination that reached this line.

## Decision

1. Added a `PROMOTED_TASK_PHASE = "iterate"` constant in `triage.ts`,
   doc-commented with the exact downstream mechanism it fixes, and passed
   `phase: PROMOTED_TASK_PHASE` into the promote handler's `store.create()`
   call — mirroring the existing hardcoded `PROMOTED_TASK_ACTION_ID`
   pattern, since every promoted task is unconditionally iterate work.
2. Added the missing `plugins/` prefix to the SKILL.md pointer-line
   template in `launcher-codex.ts`, and updated the two existing
   `launcher-codex.test.ts` assertions that had encoded the old, wrong
   path.
3. Added `server/src/routes/triage.promote-phase.test.ts`, a new focused
   test asserting a promoted task's `phase` is stamped `"iterate"` via the
   real `POST /api/triage/:projectId/promote` route.

## Consequences

A triage-promoted Codex-runtime task now reliably receives the SKILL.md
pointer instruction (unless its project's AGENTS.md already covers the
iterate phase), and that instruction now points at a real, resolvable path
for every phase, not just the one combination that happened to suppress
the bug. No client-visible change: the promoted-task phase badge already
derived from `actionId === "new-iterate"` independently of `phase`
(confirmed by the spec-reviewer's side-effect check), so this diff has no
UI regression surface. The idempotent-recovery branch of promote (reusing
a prior task via `findByPromotedFromTriageId`) still does not touch
`phase` for a previously-created task lacking it — noted by code-reviewer
as a pre-existing, out-of-scope edge case, not a regression from this fix.

## Rationale

Both fixes were derived from verified evidence (the actual Codex rollout
JSONL and a direct grep sweep of every construction/consumer site for both
strings), not from re-guessing at the original, disproven hypothesis. The
broader architectural question this incident originally seemed to raise —
whether Codex reliably executes Shipwright's plugin/skill prose at all —
is tracked separately as a revised, Opus-reviewed reference spec
(`shipwright` monorepo, `Spec/codex-plugin-execution-reliability.md`);
implementing that spec's M1-M5 is explicitly deferred, out of scope here.

## Rejected alternatives

- **Do nothing / close as "already works"** — rejected once the two
  concrete, reproducible bugs were confirmed via direct code+test
  inspection, independent of the disproven worktree hypothesis.
- **Fold this into the M1-M5 general-fix spec work** — rejected per Sven's
  explicit sequencing: land the two concrete bug fixes now as a small
  iterate, keep the general Codex-plugin-execution-reliability spec work
  as a separate, deferred track.

## Spec impact

`spec_impact: none` (bug fix restoring already-documented Codex Light v1
prompt-construction behavior — see `finalize_payload.json`'s
`none_reason`). No FR text changes; the fix makes the implementation match
behavior the launch-prompt mechanism (Spec/codex-light-webui.md §2.3) was
already specified to have.
