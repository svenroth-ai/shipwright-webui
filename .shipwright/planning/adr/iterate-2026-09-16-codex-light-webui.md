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
| 6 | MEDIUM (OpenAI) | RuntimeToggle seed can race `useSettings()` resolving after the modal opens | `useNewIssueFormState.ts` | **rejected-with-reason** — `autonomy`'s seed has the identical pre-existing race, unrelated to this iterate; fixing only `runtime` would be an inconsistent asymmetric fix to two toggles this spec deliberately mirrors. Documented in-source |
| 7 | MEDIUM (GLM) | `delivery_pending` re-polls the oracle every 60s tick indefinitely | `codex-task-watcher.ts` | **rejected-with-reason** — spec's own "Open items" #4 names this exact interval a build-time call; 60s matches the watcher's one existing tick. Documented in-source |
| 8 | MEDIUM (OpenAI) | Launch confirmation treats any pty bytes (e.g. a shell-prompt echo) as "Codex started" | `pty-manager.ts` / `codex-task-watcher.ts` | **rejected-with-reason** — `lastDataAt` is a shared, heavily-consumed generic idle timer (ADR-068-A1); AC8 already closes the common cause; a Codex-specific signal needs the same fragile TUI matching already accepted as a gap elsewhere. Documented in-source |
| 9 | LOW/edge (GLM) | Codex pty spawn env merge (`buildSpawnEnv` over `process.env`) claimed but unverified end-to-end | `ws-upgrade-handler.ts` / `routes.ts` | **accepted-and-fixed** — new `create-node-pty-spawn-fn.test.ts` mocks `@lydell/node-pty` and proves the real production spawn path merges caller env over the full `process.env` |

Doubt-reviewer (internal, full-diff pass) surfaced 2 additional medium
findings, both fixed (boardColumn not synced on Codex auto-completion —
AC-6 parity with `/close`; the `launch_confirmation_failed` clearing gap,
independently also caught by external review's finding #4 above) plus 2
low-severity accepted-not-fixed dispositions (documented in-source:
`codex-oracle-runner.ts`'s orphan-process risk on Windows, mirroring an
already-accepted `triage-cli-runner.ts` pattern; `codex-thread-discovery.ts`'s
4KB `session_meta` read cap).
