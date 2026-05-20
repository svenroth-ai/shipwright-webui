---
iterate: G-flicker-env-and-resume-gating
campaign: headless-terminal-refactor
type: fix
complexity: small
risk_flags: []
date: 2026-05-13
adr: ADR-095
---

# Iterate G — Claude TUI flicker workaround + Resume-button gating

## Context

Two UAT-reported regressions after v0.10.0 (post-Iterate F merge):

### Issue 1 — Cursor flicker during Claude TUI streaming output

User: "Wenn er arbeitet und die typischen Claude Wörter kommen, dass springt
vorne und hinten des wortes der Cursor hin und her. Der Cursor flackert."

Root cause (widely-known industry issue, not our bug):

- Claude Code TUI uses Ink/React → full re-renders per streaming update →
  per-frame ANSI cursor moves + writes.
- Modern terminals batch these via **DECSET 2026 (Synchronized Output)** so
  each frame is atomic.
- **xterm.js 5.5.0** (our pinned version) does NOT support DECSET 2026 —
  every intermediate cursor state is visible → flicker. xterm.js 6.0.0
  (Dec 2024) added support via PR #5453 but the upgrade is a breaking
  change (windowsMode removed, Canvas renderer removed) and would
  invalidate ADR-088 snapshot version pin.
- References: Claude Code Issues #37283, #1913, #18084, #769, JetBrains
  YouTrack IJPL-204106, Wave Terminal Issue #2787 — all the same root.

Anthropic's official workaround:
[`CLAUDE_CODE_NO_FLICKER=1`](https://code.claude.com/docs/en/fullscreen) —
Claude Code renders into the alt-screen buffer (like vim/htop) bypassing
the per-frame ANSI position writes entirely. Requires Claude Code
≥ v2.1.89 (we run 2.1.139 per `/api/diagnostics`).

### Issue 2 — Resume button obsolete in the common idle/active case

User: "Resume braucht es glaube ich gar nicht mehr. wenn ich zurück komme
zum Task (wenn er idle ist), steht das Terminal immer noch da. der Resume
knopf kopiert dann den Resume text in das Terminal, aber das brauchen wir
gar nicht. Kann es sein, dass mit dem refactor der Resume knopf obsolet
wird?"

Diagnostic:

- Pre-Campaign: nav-away → return → blank terminal (chunked replay
  corrupted for new-plain, ADR-086 skip). Resume button pasted
  `claude --resume <uuid>` to re-establish session.
- Post-Campaign (v0.10.0 with Iterate E live-pty serialize + Iterate F
  xterm config): nav-away → return → terminal shows last state via
  `replay_snapshot`. If pty alive AND Claude TUI still running, the user
  can just TYPE — Resume is unnecessary friction. If clicked, it pastes
  `claude --resume <uuid>` into a shell that already has Claude → either
  error or nested Claude.

Resume IS still needed when:

| Task state                        | pty alive | Claude in TUI       | Resume needed |
|-----------------------------------|-----------|---------------------|---------------|
| `active`                          | yes       | yes                 | NO            |
| `idle`                            | yes       | yes (at prompt)     | NO            |
| `idle`                            | yes       | no (Claude exited)  | YES           |
| `done`                            | no        | n/a                 | YES           |
| `launch_failed` / `jsonl_missing` | no        | n/a                 | YES           |

The conservative, correct gating signal is **`liveSession` = pty entry
present** (server-side `PtyManager.get(taskId) !== undefined`). When the
pty is alive, the Claude TUI is either running or one keystroke away;
either way the Resume copy-command is wrong. When the pty is gone,
Resume is the only path back.

The narrow "shell-back-but-pty-alive" case (idle 4 above) loses the
Resume button. Trade-off accepted: users can type `claude --resume`
manually, or close the terminal session (which kills the pty) to get
the Resume CTA back. The far-larger common case (Claude alive, nav
back, button clicked → corrupted state) is the priority.

## Goal

1. Inject `CLAUDE_CODE_NO_FLICKER=1` into the env of every pty spawned
   for embedded-terminal sessions, with explicit `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`
   opt-out for users who prefer the classic renderer.
2. Surface `liveSession: boolean` on the task-state response and gate
   the header Resume CTA on it client-side: hide while pty is alive.

## Scope

### Modify

- `server/src/terminal/routes.ts` (`createNodePtySpawnFn`):
  - Inject `CLAUDE_CODE_NO_FLICKER` into the constructed `termEnv` map,
    gated by `process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER !== "0"`
    (default-on, opt-out via `=0`).
  - Inline comment cross-references ADR-095 + Anthropic docs URL.
- `server/src/config.ts`:
  - New field `terminalNoFlicker: boolean` (default true, opt-out via
    `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`) so the config surface mirrors
    other terminal env vars (`SHIPWRIGHT_TERMINAL_*`). Field is for
    diagnostic surfacing + future structured logging; the actual env
    injection still reads `process.env` directly in
    `createNodePtySpawnFn` because the spawn fn doesn't take config.
- `.env.example`:
  - Document `SHIPWRIGHT_TERMINAL_NO_FLICKER` with default behavior +
    when to set it to `0`.
- `server/src/external/routes.ts`:
  - Where `GET /api/external/tasks` and `GET /api/external/tasks/:id`
    return the serialized task, augment the response with
    `liveSession: ptyManager.get(taskId) !== undefined`. Field is
    additive — the persisted `ExternalTask` shape is unchanged.
  - Apply the same augmentation to the transcript response branches
    that include `task` (used as the cache-refresh side-channel by
    the client polling loop) so the Resume CTA gating updates on the
    same tick the transcript catches a state change.
- `client/src/lib/externalApi.ts`:
  - Add optional `liveSession?: boolean` to `ExternalTask` (optional
    for back-compat with v1 responses + unit-test fixtures that omit
    it).
- `client/src/components/external/TaskDetailHeader.tsx`:
  - Update `ctaFor(state, liveSession)` so `state === "idle"` returns
    `"resume"` ONLY when `liveSession === false`. When pty is alive +
    state is `idle`, the CTA falls back to "none" (the embedded
    terminal pane is the user's interaction surface).
- `server/src/external/routes-tasks-list.test.ts` (NEW or extend
  existing test): assert the GET response includes `liveSession`.
- `server/src/terminal/pty-env-flicker.test.ts` (NEW): assert
  `createNodePtySpawnFn`-equivalent env construction sets/omits
  `CLAUDE_CODE_NO_FLICKER` per `SHIPWRIGHT_TERMINAL_NO_FLICKER` env.
- `client/src/components/external/TaskDetailHeader.test.tsx` (extend):
  add cases for `state="idle" + liveSession=true` (no CTA) and
  `state="idle" + liveSession=false` (Resume CTA).

### Out of scope

- xterm.js 6.0 upgrade (deferred to future Iterate H — breaking
  changes, ADR-088 snapshot pin invalidation).
- Snapshot / scrollback protocol changes — orthogonal.
- Any wider Resume-button design overhaul; this iterate is the
  minimal gating fix.

## Affected Boundaries

None. The added `liveSession` field is server→client only and additive;
client fields are optional. Env-var injection happens at pty spawn —
not a serialized-format boundary. No round-trip producer/consumer.

## Acceptance Criteria

- [ ] `createNodePtySpawnFn` constructs `termEnv` containing
      `CLAUDE_CODE_NO_FLICKER: "1"` when `SHIPWRIGHT_TERMINAL_NO_FLICKER`
      is unset, `""`, or any value other than `"0"`.
- [ ] When `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`, the env map does NOT
      contain a `CLAUDE_CODE_NO_FLICKER` key (so child shell inherits
      whatever upstream env set, including the un-set state).
- [ ] `server/src/config.ts` exposes `terminalNoFlicker: boolean` and a
      smoke test (or inline check) verifies the env-to-config mapping.
- [ ] `GET /api/external/tasks` and `GET /api/external/tasks/:id`
      include `liveSession: boolean` on each task object.
- [ ] Transcript responses that include `task` (status="ok",
      status="missing", status="rotated") include the augmented
      `task.liveSession` so the client polling loop refreshes the
      gating signal.
- [ ] Client `ExternalTask.liveSession?: boolean` is added; missing
      field is treated as `false` (conservative: show Resume) for
      back-compat.
- [ ] `TaskDetailHeader` Resume CTA is HIDDEN when
      `state === "active"` (already true via the existing `ctaFor`)
      OR when `state === "idle" && liveSession === true`.
- [ ] `TaskDetailHeader` Resume CTA is VISIBLE when
      `state === "idle" && liveSession !== true`.
- [ ] Existing client + server test suites stay green.
- [ ] No new TypeScript errors (`server && npm run build`,
      `client && npm run build` exit 0).
- [ ] ADR-095 written: industry context, official Anthropic workaround
      URL, xterm.js 5.5.0 DECSET 2026 limitation, deferral of
      xterm 6.0 upgrade, Resume button gating design + trade-offs.
- [ ] Manual UAT post-merge: user confirms (1) flicker reduced/gone
      in-session, (2) Resume button hidden during live Claude TUI,
      visible when task done.

## Verification

- **server unit:** vitest covers env-construction in
  `createNodePtySpawnFn` (factored helper or inline check) + augmented
  task-list response.
- **client unit:** vitest covers `TaskDetailHeader` Resume CTA
  visibility for `idle + liveSession=true` and `idle + liveSession=false`.
- **build:** `server && npm run build`, `client && npm run build`
  both green.
- **F0.5 Surface:** `cli` — the flicker fix is verifiable via the
  unit test that asserts env-var injection; Resume gating is
  verifiable via the new TaskDetailHeader vitest cases. A
  Playwright spec would require driving a real Claude TUI through
  a real pty in CI, which exceeds the iterate's scope.
- **manual UAT:** user navigates to a task with live Claude → confirms
  no flicker on streaming output AND no Resume button visible. User
  closes the task (kills pty) → confirms Resume button reappears.

## Rejected Alternatives

1. **Upgrade xterm.js to 6.0** — breaking changes (windowsMode removed,
   Canvas renderer removed) and would invalidate ADR-088 snapshot
   version pin. Deferred to a separate Iterate H.
2. **Always show Resume regardless of state** — keeps the status quo
   but doesn't fix the UAT-reported issue. Rejected.
3. **Auto-detect "shell is in TUI" via ANSI escape sniffing** — would
   correctly cover the rare "idle + pty alive + Claude exited"
   sub-case but adds protocol complexity and a new failure mode.
   Rejected: the pty-alive heuristic is correct in the common case
   and the trade-off is documented.
4. **Set `CLAUDE_CODE_NO_FLICKER` only for the first spawn or per task
   slug** — adds state-tracking complexity. Rejected: env injection
   is a per-spawn invariant; default-on is the simplest mental model.

## Risk

LOW. No I/O boundary, no migration, no schema change. The env-var
injection is documented Anthropic public API and easy to roll back
(unset the env var). The `liveSession` field is additive and ignored
by older clients. The Resume button gating change has a narrow
failure mode (the "idle + pty alive + Claude exited" sub-case where
the user has to type `claude --resume` manually or stop the terminal
session). Recoverable via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` env or
a follow-up iterate restoring the always-visible Resume CTA.
