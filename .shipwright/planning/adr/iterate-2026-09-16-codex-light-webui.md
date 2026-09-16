# Codex Light — Codex CLI as an alternate task runtime

## Context

Shipwright Command Center only ever launched Claude Code. "Codex Light"
(`Spec/codex-light-webui.md` in the sibling monorepo) adds the Codex CLI as
a second, per-task-selectable runtime, so an operator can run Claude- and
Codex-driven tasks side by side — motivated by wanting a fallback (and a
deliberate side-by-side choice) once Claude quota runs out, not only an
emergency switch.

## Decision

Add `task.runtime: "claude" | "codex"`, immutable per task once created,
seeded from a new global `settings.codexRuntimeDefault` and freely
overridable per task via a new `RuntimeToggle` (mirrors `AutonomyToggle`'s
visual language, a different axis). The launch chokepoint
(`external/launch/runtime-chokepoint.ts`) branches on `task.runtime`:
Claude keeps its existing command-string path unchanged; Codex gets
`buildCodexCommands` (`core/launcher-codex.ts`), a plain interactive-TUI pty
launch (never the app-server protocol in v1), with autonomy mapped onto
Codex's own `approvalPolicy`/`approvalsReviewer`/`--enable
default_mode_request_user_input` vocabulary (§3's confirmed mapping).

Completion detection replaces Claude's heartbeat model entirely for Codex:
a completion-oracle CLI (`core/codex-oracle-runner.ts`, spawned the same
injection-safe way `triage-cli-runner.ts` already does) is polled by a new
`CodexTaskWatcher` (`core/codex-task-watcher.ts`) whenever a Codex task's
pty goes silent past a configurable stall timeout, classifying into
done / not_done+nudge / delivery_pending(+error) / no_oracle per §5.1's
table. §5.4's structured self-report
(fenced ```SHIPWRIGHT-STATUS``` block, `core/codex-status-report.ts`) is
consulted only for `no_oracle` phases with no other completion signal —
every other verdict always defers to the oracle on disagreement. A resumed
Codex session (`codex resume <threadId>`) carries the same autonomy/
env-inherit flags as a fresh launch (verified live: `codex resume --help`
accepts them identically) — §2.2's terse example text is not a CLI
constraint. `threadId` is discovered after the fact, filename-first, from
`~/.codex/sessions/**/rollout-*.jsonl` (`core/codex-thread-discovery.ts`),
since Codex has no `--session-id`-equivalent launch flag. Readiness
(`readiness-probe.ts`) reports both CLIs as informational with "at least
one available" as the real critical gate, plus a launch-time
`codex_cli_not_found` check at the chokepoint itself (AC8) independent of
that probe. Campaign and `new-pipeline` launches are blocked for Codex,
keyed on `parsed.actionId`/campaign intent, not `phase` (a corrected
2026-09-16 finding — `phase` is never submitted on the pipeline surface).

## Consequences

Every Claude-only code path is untouched (verified: `runtime === "claude"`
passes through byte-identical at the chokepoint, zero regressions across
4274 server + full client tests). Codex tasks gain independent, weaker
completion evidence than Claude's JSONL-based heartbeat — degradation is
always reported via the oracle's own `evidence` field, never silently
presented as exact. `CodexTaskWatcher` adds one more unref'd 60s
`setInterval` alongside the existing ones in `index.ts`.

## Rationale

The oracle+watcher design (vs. an app-server heartbeat) was chosen because
v1 launches Codex as a plain pty TUI (no new terminal-stack code, matching
CLAUDE.md rule 1's "webui never spawns" boundary at the command-string
level) — an app-server protocol integration is deliberately deferred to a
"Codex Light 2" campaign-capable follow-up. The self-report is consulted
only for the one case (`no_oracle`) where it is the only signal available,
keeping the oracle authoritative everywhere else.

## Rejected alternatives

Building Codex's own app-server-based heartbeat (matches Claude's model
closely, but requires new terminal-stack code and defers Campaign support
regardless); making `readiness-probe.ts` mark Codex `critical: true` like
Claude's old unconditional flag (would block readiness for an all-Claude
machine with no Codex CLI, defeating the per-task toggle's whole point).

## External-Code-Review-Findings

Branch A (OPENROUTER_API_KEY present, `external_code_review.enabled: true`)
— GLM + OpenAI, both verdict `revise` (agree within one step, no
contradiction requiring resolution). All 9 findings dispositioned:

| # | Severity | Finding | File | Disposition |
|---|---|---|---|---|
| 1 | HIGH (OpenAI) | AC8: no launch-time Codex-CLI-availability check | `runtime-chokepoint.ts` | **accepted-and-fixed** — `isCodexCliAvailable()` + `codex_cli_not_found` 400 block, 2 new tests |
| 2 | HIGH (GLM) | `PATCH /tasks/:id` never handled `runtime` — EditTaskModal toggle a silent no-op server-side | `patch.ts` | **accepted-and-fixed** — `runtime` added to `PATCHABLE` + handling block, `routes.patch-runtime.test.ts` |
| 3 | MEDIUM (GLM) | `codex resume` dropped env-inherit + autonomy flags a fresh launch gets | `launcher-codex.ts` | **accepted-and-fixed** — verified live that `codex resume --help` accepts the same flags; threaded through, tests updated |
| 4 | MEDIUM (GLM) | `launch_confirmation_failed`/`delivery_error` notices never cleared once the triggering condition resolved | `codex-task-watcher.ts` | **accepted-and-fixed** — both now clear on the next tick that no longer matches; 3 new tests |
| 5 | MEDIUM (OpenAI) | §5.4 self-report composed into every prompt but never parsed/cross-checked | `codex-task-watcher.ts` | **accepted-and-fixed** — new `codex-status-report.ts` parser, consulted for `no_oracle`'s one behavior-changing case; oracle stays authoritative elsewhere |
| 6 | MEDIUM (OpenAI) | RuntimeToggle seed can race `useSettings()` resolving after the modal opens | `useNewIssueFormState.ts` | **accepted-and-fixed** — originally rejected-with-reason here (fixing only `runtime` would have been asymmetric with `autonomy`'s identical pre-existing race); the local PR-review preflight re-flagged the same finding and, per that gate's own remedy, both toggles were fixed together — touched-ref pattern + a re-seed effect per toggle, wrapped setters. Documented in-source |
| 7 | MEDIUM (GLM) | `delivery_pending` re-polls the oracle every 60s tick indefinitely | `codex-task-watcher.ts` | **rejected-with-reason** — spec's own "Open items" #4 names this exact interval a build-time call; 60s matches the watcher's one existing tick. Documented in-source |
| 8 | MEDIUM (OpenAI) | Launch confirmation treats any pty bytes (e.g. a shell-prompt echo) as "Codex started" | `pty-manager.ts` / `codex-task-watcher.ts` | **rejected-with-reason** — `lastDataAt` is a shared, heavily-consumed generic idle timer (ADR-068-A1); AC8 already closes the common cause; a Codex-specific signal needs the same fragile TUI matching already accepted as a gap elsewhere. Documented in-source |
| 9 | LOW/edge (GLM) | Codex pty spawn env merge (`buildSpawnEnv` over `process.env`) claimed but unverified end-to-end | `ws-upgrade-handler.ts` / `routes.ts` | **accepted-and-fixed** — new `create-node-pty-spawn-fn.test.ts` mocks `@lydell/node-pty` and proves the real production spawn path merges caller env over the full `process.env` |

Doubt-reviewer (internal, full-diff pass) surfaced 2 additional medium
findings, both fixed (boardColumn not synced on Codex auto-completion —
AC-6 parity with `/close`; the `launch_confirmation_failed` clearing gap,
independently also caught by external review's finding #4 above) plus 2
low-severity accepted-not-fixed dispositions (documented in-source at the
time: `codex-oracle-runner.ts`'s orphan-process risk on Windows, mirroring
an already-accepted `triage-cli-runner.ts` pattern; `codex-thread-
discovery.ts`'s 4KB `session_meta` read cap). **The first of those two was
later fixed, not merely re-accepted — see "Required CI PR Review gate
(post-push)" below**, once the actual required gate independently blocked
on it.

**Local PR-review preflight (2026-09-16, run 3+), 3 more findings:**
1. `useNewIssueFormState.ts` re-flagged finding #6's settings-race — see #6's
   updated disposition above (accepted-and-fixed).
2. `codex-task-watcher.ts`: a `nudge_sent` Inbox notice survived past the
   stall episode that triggered it (new pty output resumed, task never
   reached `done`) — **accepted-and-fixed**, cleared on the same "fresh
   episode" branch that already resets `episode.nudged`.
3. `triage.ts:318`: `getCodexRuntimeDefault()`'s return value flowed into
   `store.create()` unnormalized — **accepted-and-fixed**, coerced to
   `"codex" | "claude"` at the call site.

Two more raised, **rejected-with-reason**: (a) `codex-oracle-runner.ts`'s
recurring `execFile` cadence — this is the SAME orphan-process risk the
internal doubt-reviewer already dispositioned accepted-not-fixed above (same
file, same mechanism, same reasoning: `CodexTaskWatcher.tick()` bounds this
to one in-flight oracle call per task, so the recurring cadence is "more
repeats of an existing accepted risk," not a new class); the local preflight
re-surfaced it as a blocking "needs maintainer confirmation," but it names no
gap the in-source disposition doesn't already cover. (b) untracked
`.shipwright/.cache/*.claim` / `github_import_state.json` session-runtime
artifacts flagged as "committed" — they are untracked working-tree files
this session's own hooks wrote, never `git add`ed, and confirmed absent from
`git status --porcelain` staged output; the local preflight builds its
review context from the full working tree including untracked files (a
known gap — [[project_pr_review_gate_gotchas]]-adjacent), so this finding
cannot reproduce against the actual pushed diff.

**Local PR-review preflight, run 4** (after the 2 fixes above, re-run to
confirm): the same 3 themes recur, none new. **Confirmed non-issues, no
further action**: the untracked cache-artifact false positive (b above,
still present, still not staged — every run of this local tool re-includes
the working tree's untracked files; the actual pushed PR diff cannot
contain them). **Confirmed already-handled by established convention**: a
re-flag of the `shipwright_bloat_baseline.json` bumps made this iterate
(4 pre-existing ratchets + `triage.ts`'s +3 lines above) as "changing a CI
enforcement policy" — the project's own established remedy for a disputed
bloat-baseline bump is exactly what was done: bump `current` and append a
`note` explaining the growth, not a new ADR-gated `state` ([[project_bloat_baseline_note_field_resolves_ratchet_dispute.md]]),
and this file is itself one of rule 30's named sensitive paths — meaning
routing it through Tier-3 review (this exact mechanism) is the designed
process, not a bypass of it. **Rejected-with-reason, unresolved by further
code changes**: the PTY-spawn "needs maintainer confirmation" theme
recurred a second time, now spanning `ws-upgrade-handler.ts` /
`routes.ts` / `pty-manager.ts` generally rather than one specific line (it
named `ws-upgrade-handler.ts`'s env-merge in run 1, `codex-oracle-runner.ts`
in run 2, and the whole PTY family here) — across 3 distinct framings this
tool has not named one fixable defect in this area beyond findings #1 and
#9 above, which already have code fixes and tests. This reads as this
reviewer's inherent, structural caution about ANY diff that adds a new
subprocess-spawning runtime, not a discrete gap; the tool's own output
states plainly it "cannot satisfy the required CI PR-review gate; that
gate still reviews the pushed PR independently" — proceeding to push and
letting that gate render its own (independent) verdict on the actual diff.

**Required CI PR Review gate (post-push, PR #466): BLOCK.** The bet above
did not pay off on this specific finding — the actual, independently-derived
Tier-3 reviewer (a different model, reviewing the real pushed diff via the
GitHub API, not this session's working tree) blocked on exactly the theme
the local preflight kept re-surfacing: `codex-oracle-runner.ts`'s recurring
`execFile` cadence (60s/stalled-task, indefinitely) versus
`triage-cli-runner.ts`'s once-per-click cadence for the identical spawn
pattern. Its blocking comment offered two paths: explicit maintainer
sign-off accepting the existing risk, or "a bounded/reaped subprocess
strategy with an integration test covering shutdown and repeated
stalled-task ticks." **Sven chose hardening over sign-off** — the recurring
cadence made the accepted-risk framing untenable long-term ("das ist ja bei
jeder codex session" — every Codex session hits this, not a rare edge) —
and asked for a second opinion from an Opus-model review pass before
implementation, which surfaced that the fix infrastructure already existed:
`preview-child-lifecycle.ts`'s `treeKill()` (win32 `taskkill /pid <pid> /t
/f`, POSIX `kill(-pid)` via a `detached` spawn), already production (ADR-248/
F13), already tested, and specifically NOT the `tree-kill` npm package
(`decision_log.md` records that as a deliberately pruned dependency — do not
re-add it).

**Fix**: new `core/cli-child-spawn.ts` — one shared spawn wrapper for both
`codex-oracle-runner.ts` and `triage-cli-runner.ts` (previously
byte-identical, divergence-prone `execFile(..., { timeout })`
implementations), replacing `execFile` with `spawn` (`execFile`'s TS surface
has no `detached` option at all) and driving an owned timer that tree-kills
the whole process group on timeout instead of relying on `error.killed`
(which never fires for an externally-driven kill — `taskkill`/`process.kill`
never call `child.kill()`, so the old per-file `if (e.killed)` timeout branch
would have silently misclassified a tree-killed run). `index.ts`'s
`shutdown()` and its `process.on("exit", ...)` handler now also tree-kill
any in-flight CLI child and `clearInterval(codexWatcherTimer)`, mirroring
the existing `previewManager.killAll()` / `ptyManager.killAll()` precedent
— the Opus pass's finding that the bigger orphan risk was actually
`shutdown()` never touching an in-flight oracle child at all, not just the
30s-hang case. Tests: `cli-child-spawn.test.ts` — timeout drives a real
tree-kill (never `child.kill()` directly), the shutdown registry
tracks/untracks correctly, POSIX/win32 spawn-detached agreement, plus one
REAL process-tree integration test (no `uv`/Python dependency — spawns node
against itself, proving a genuine grandchild process dies on timeout on
both platforms).

**Local PR-review preflight, round 2** (before pushing the hardening fix):
one genuine finding, fixed — the tree-kill on timeout was fire-and-forget
with no second bound; a failed/ignored kill (unresponsive process, a
`taskkill` that silently did nothing) would have left the promise pending
and the child tracked forever, defeating the "bounded" half of "bounded/
reaped subprocess strategy". Fixed with a `KILL_GRACE_MS` (5s) fallback
timer that force-resolves (and untracks) regardless of whether the OS
actually cooperated, plus a `try/catch` around the tree-kill call itself so
a synchronous throw can't skip the grace bound. Two more tests cover both:
a hung child that never closes, and a `treeKill` that throws. The other
finding raised (untracked `.shipwright/.cache/*.claim` session artifacts)
is the same confirmed false positive as earlier rounds — still genuinely
untracked (`git ls-files` returns empty for both `client/.shipwright` and
`server/.shipwright`), never staged.
