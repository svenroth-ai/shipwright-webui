# ADR-095 spec — Claude TUI flicker workaround + Resume-button gating via liveSession

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-095.
**Status:** accepted.
**Date:** 2026-05-13.
**Section:** Iterate G — fix; campaign `headless-terminal-refactor`.
**Predecessors:** ADR-088/089 (snapshot replay infrastructure), ADR-093/094 (Iterate F xterm config).
**Partially superseded by:** ADR-097 (xterm.js 6 upgrade reverted the `CLAUDE_CODE_NO_FLICKER` default-OFF clause; ADR-098 restored ADR-095's default-ON stance). The Resume-button gating via `liveSession` stayed in force until ADR-111 retired it together with the entire pty-foreground signal pipeline.

## Extended Context

### Issue 1 — Cursor flicker during Claude TUI streaming output

User report (verbatim): *"Wenn er arbeitet und die typischen Claude Wörter kommen, dass springt vorne und hinten des wortes der Cursor hin und her. Der Cursor flackert."*

Widely-documented Claude Code TUI rendering symptom across multiple terminal hosts:

- claude-code Issue [#37283](https://github.com/anthropics/claude-code/issues/37283) (cursor flicker).
- claude-code Issue [#1913](https://github.com/anthropics/claude-code/issues/1913) (text flickering during streaming).
- claude-code Issue [#18084](https://github.com/anthropics/claude-code/issues/18084) (cursor jumping).
- claude-code Issue [#769](https://github.com/anthropics/claude-code/issues/769) (TUI redraw artifacts).
- JetBrains YouTrack IJPL-204106 (same in IDEA's embedded terminal).
- Wave Terminal Issue [#2787](https://github.com/wavetermdev/waveterm/issues/2787).

Root cause: Claude Code TUI uses Ink/React; every streaming output update fires a full re-render that emits a sequence of ANSI cursor moves plus writes. Modern terminals batch these via **DECSET 2026 (Synchronized Output)** so the host displays each frame atomically. xterm.js 5.5.0 (our pinned version at the time, ADR-088) did NOT support DECSET 2026 → every intermediate cursor position rendered visibly → cursor visibly jumped back and forth across word boundaries.

Anthropic ships an official workaround: `CLAUDE_CODE_NO_FLICKER=1`. With the flag set, Claude Code renders into the alt-screen buffer (vim / htop-style) and bypasses the per-frame ANSI cursor-position writes entirely. Requires Claude Code ≥ v2.1.89.

### Issue 2 — Resume button obsolete in the common idle / active case

User report (verbatim): *"Resume braucht es glaube ich gar nicht mehr. wenn ich zurück komme zum Task (wenn er idle ist), steht das Terminal immer noch da. der Resume knopf kopiert dann den Resume text in das Terminal, aber das brauchen wir gar nicht."*

Pre-Campaign: nav-away → return → blank terminal (chunked replay corrupted for new-plain, ADR-086 skip). Resume pasted `claude --resume <uuid>` to re-establish the session. Post-Campaign with Iterate E live-pty serialize + Iterate F xterm config: nav-away → return → terminal shows last state via `replay_snapshot`. If the pty is alive AND Claude TUI is still running, the user can just type into the embedded terminal — Resume is unnecessary friction; clicked, it pastes `claude --resume <uuid>` into a shell already inside Claude (either error or spawns a nested instance). Resume IS still needed when the pty is gone (`state ∈ {done, launch_failed, jsonl_missing}` or `state=idle` AND no live pty entry).

## Decision

Two targeted, scope-bounded fixes; both opt-out-able; both additive at the wire boundary:

### F1 — `CLAUDE_CODE_NO_FLICKER=1` injected into every pty spawned for the embedded terminal

- `server/src/terminal/routes.ts`: factor env-construction out of `createNodePtySpawnFn` into a pure `buildSpawnEnv(baseProcessEnv, callerEnv?)` helper. The helper layers `baseProcessEnv → ADR-067 brand-fit overrides (TERM=dumb, COLORTERM="", FORCE_COLOR=1) → CLAUDE_CODE_NO_FLICKER toggle → callerEnv`. Toggle semantics: default-on; explicit opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` (the literal string `"0"` — empty / unset / any other value keeps the fix enabled). On opt-out, the `CLAUDE_CODE_NO_FLICKER` key is **deleted** from the map (not set to `undefined` or `"0"`) so the child shell sees whatever the upstream env had. External code-review fix (openai medium, 2026-05-13): opt-out wins over caller-supplied `CLAUDE_CODE_NO_FLICKER`; the rest of `callerEnv` still flows through.
- `server/src/config.ts`: new `terminalNoFlicker: boolean` field for diagnostics + structured logging parity with `terminalHeadlessMirror`. Same parse rule (any value other than `"0"` → true). The actual env injection still reads `process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER` directly in `buildSpawnEnv` because the spawn factory does not thread a `ServerConfig` reference.
- `.env.example`: a new section documents `SHIPWRIGHT_TERMINAL_NO_FLICKER` with the trade-off (alt-screen sessions don't leave conversation history in xterm scrollback for browser Cmd+F).

### F2 — `liveSession: boolean` surfaced on task-state responses; header Resume CTA gated on it

- `server/src/external/routes.ts`: a new closure-scoped `withLiveSession(task)` helper augments each serialized task with `liveSession = ptyManager.get(taskId) !== undefined`. Applied to every route that returns `task` (or `tasks[]`): GET `/tasks`, GET `/tasks/:id`, POST `/tasks`, POST `/launch`, POST `/fork`, PATCH `/tasks/:id`, POST `/close`, GET `/transcript` (all branches). The augmented field is NOT persisted on disk — computed at the wire boundary from in-memory `PtyManager.entries`.
- `client/src/lib/externalApi.ts`: optional `liveSession?: boolean` added to `ExternalTask`. Optional so older v1 server responses + test fixtures keep loading; `undefined` is treated as `false` (conservative: show Resume).
- `client/src/components/external/TaskDetailHeader.tsx`: `ctaFor(state, liveSession)` updated. When `state === "idle" && liveSession === true`, the function returns `"none"`.

### Resume CTA visibility matrix (post-G)

| state | liveSession | CTA |
|---|---|---|
| draft / awaiting_external_start | any | Launch (green) |
| active | any | none (badge only) |
| idle | `true` | none (user types directly) |
| idle | `false` / undefined | Resume (orange) |
| done / launch_failed / jsonl_missing | any | none |

## Rationale

Plan-D″ "user-initiated" invariant (ADR-067) is preserved: webui spawns no Claude process directly. The env injection happens at the SHELL spawn (whitelisted shells only — ADR-067 whitelist intact); Claude Code reads its env when the user types `claude`. This is identical to setting `CLAUDE_CODE_NO_FLICKER=1` in a shell rc and is therefore not a new Claude-launch surface.

For Resume gating: `pty entry present` is the single authoritative signal. The server already exposes it via `PtyManager.get(taskId)`; we lift it to the wire boundary without persisting on disk. Narrow edge case — `idle + pty alive + Claude exited /exit, shell back at prompt` — loses the Resume CTA. Recoverable manually (user types `claude --resume <uuid>`) or via "Stop terminal session" menu item.

Why not upgrade xterm.js 6.0 instead: breaking-change upgrade (windowsMode removed, Canvas renderer removed) AND would invalidate the ADR-088 snapshot version pin. The env-flag workaround is reversible and zero-blast-radius; the upgrade is a multi-iterate refactor (deferred to Iterate I — see ADR-097/098).

Trade-offs of alt-screen rendering:
- **Loss:** Native browser Cmd+F search of conversation history is degraded; alt-screen content doesn't persist into xterm scrollback the way normal-screen output does. Mouse capture changes (rougher selection in some scenarios).
- **Gain:** No per-frame ANSI cursor-position flicker.

## Consequences

- `server/src/terminal/pty-env-flicker.test.ts` (NEW, 9 cases): `buildSpawnEnv` semantics — default-on, opt-out via `=0`, opt-out wins over caller-supplied key, brand-fit preserved, base env passes through.
- `server/src/external/routes.live-session.test.ts` (NEW, 5 cases): `GET /tasks` + `GET /tasks/:id` return `liveSession`, flip-flop semantics (`ptyManager.get` evaluated at response-time, never cached on disk).
- `server/src/config.test.ts` (+3 cases): default-on, non-"0" values stay true, "0" flips to false.
- `client/src/components/external/TaskDetailHeader.test.tsx` (+3 cases): `idle + liveSession=false` → Resume, `idle + liveSession=true` → none, regression-fence "consumption proof" test that flips ONLY `liveSession`.
- Server build: tsc clean. Server tests: 927/927. Client build clean. Client tests: 780/780.
- `.env.example` documents the opt-out + the trade-off explicitly.
- Manual UAT post-merge required for visual flicker confirmation — automated pixel-diff via Playwright is out of scope.

## External Plan Review

SKIPPED — runner contract gate requires medium+ or risk flag. Iterate G is complexity=small with no risk flags. Status: `skipped_complexity_below_threshold`.

## Self-Review (7-item canonical checklist)

1. **Spec Compliance** — PASS: all 11 ACs covered.
2. **Error Handling** — PASS: `withLiveSession` defensively passes through `undefined`/`null` so 404-path callers stay safe. `buildSpawnEnv` falls back cleanly when caller env not passed.
3. **Security Basics** — PASS: no new IO surface, no command construction, no auth changes. `CLAUDE_CODE_NO_FLICKER` is documented Anthropic public API. `liveSession` exposes only "pty alive yes/no".
4. **Test Quality** — PASS: 9 env-helper tests, 5 server route tests including flip-flop assertion, 3 config tests, 3 client tests including a consumption-proof regression fence.
5. **Performance Basics** — PASS: O(1) `ptyManager.get(taskId)` lookup per task on serialize.
6. **Naming & Structure** — PASS: `buildSpawnEnv` named for what it does; `withLiveSession` follows the augmentation-helper pattern.
7. **Affected Boundaries (ADR-024)** — PASS: no serialized-format change on disk. `liveSession` is server→client only (HTTP boundary, additive). Env-var injection is process→child boundary; canonical probe is `buildSpawnEnv` unit test.

## Code Review Cascade

RAN — runner contract trigger fired (diff > 100 LOC). External code review via OpenRouter (openai + gemini) surfaced 3 actionable findings; all addressed pre-commit:

- **MEDIUM (openai)** — `buildSpawnEnv` caller-env override could reintroduce `CLAUDE_CODE_NO_FLICKER` after opt-out path deleted it. Fixed: opt-out wins over caller-supplied key for that specific key only. Regression test added.
- **MEDIUM (openai)** — client tests should explicitly prove `task.liveSession` is consumed. Fixed: added the "consumption proof" test.
- **MEDIUM (openai)** — spec called for a config smoke test. Fixed: 3 new cases in `config.test.ts`.
- **HIGH (openai)** — false positive: reviewer's text-extraction missed the new untracked files; both are present.

## Falsifiability

If operator UAT post-merge still observes flicker, the F1 flag-injection hypothesis is falsified for our deployment (e.g. Claude Code didn't pick up the flag, or alt-screen mode has its own xterm.js 5.5.0 incompatibility). Iterate H (xterm.js 6.0 upgrade) becomes the candidate. If users miss the Resume button in the "shell-back-but-pty-alive" sub-case loudly, an Iterate H' restores it conditionally via a smarter signal (e.g. terminal title-bar parsing for `claude` literal).

## Rejected Alternatives

1. **Upgrade xterm.js to 6.0** — breaking changes + ADR-088 pin invalidation. Deferred (became Iterate I — ADR-097/098).
2. **Keep Resume always visible regardless of liveSession** — doesn't fix the user-reported issue.
3. **Auto-detect "shell is in TUI" via ANSI sniffing** — covers the rare "idle + pty alive + Claude exited" sub-case but adds protocol complexity.
4. **Set `CLAUDE_CODE_NO_FLICKER` only on first spawn or per task slug** — adds state-tracking complexity; per-spawn invariant is the simpler mental model.
5. **Persist `liveSession` on disk** — would create drift between in-memory truth + stale disk record. Computed-at-response-time keeps source of truth single.

## Files modified

`server/src/terminal/routes.ts`, `server/src/terminal/pty-env-flicker.test.ts` (NEW), `server/src/config.ts`, `server/src/config.test.ts`, `server/src/external/routes.ts`, `server/src/external/routes.live-session.test.ts` (NEW), `client/src/lib/externalApi.ts`, `client/src/components/external/TaskDetailHeader.tsx`, `client/src/components/external/TaskDetailHeader.test.tsx`, `.env.example`.
