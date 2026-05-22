# ADR-096 spec — Iterate H: snapshot preservation on pty death + TaskCard Resume gating

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-096.
**Status:** accepted.
**Date:** 2026-05-13.
**Section:** Iterate H — fix; campaign `headless-terminal-refactor`.
**Predecessors:** ADR-092 (Iterate E — flushMirrorSnapshot on last-detach), ADR-095 (Iterate G — CLAUDE_CODE_NO_FLICKER default-ON + liveSession Resume gate).
**Retained even after partial supersession:** ADR-097 reverted ADR-095's default-OFF for the env flag; ADR-098 restored default-ON. The 60 % preservation heuristic introduced here STAYS in force as defense-in-depth (CLAUDE.md guard #22 references it explicitly).

## Extended Context

Two user-reported regressions after v0.10.1 (post-Iterate G merge, ADR-095 in force).

### Issue 1 — Empty snapshot after overnight Claude task

A user ran a Claude task overnight; on return the embedded terminal was empty. Task state = `idle`, `liveSession = false`. The on-disk snapshot file for task `5124b107-2649-4edb-b0a5-b45873ebae82` was 158 bytes total: the `# shipwright-snapshot v1 xterm@5.5.0 113x47\n` header plus only the cell-state of a freshly-opened PowerShell prompt (`PS C:\…>` + `\e[1C\e[?1004h`). The user's multi-hour conversation history was gone.

Root-cause chain:

1. `pty.kill()` (or idle-ceiling timeout, or `Ctrl+C`) sends SIGTERM to Claude Code.
2. Claude TUI shuts down. With `CLAUDE_CODE_NO_FLICKER=1` (Iterate G default), Claude renders into the alt-screen buffer; on exit it emits `DECRST 1049` (leave alt-screen). The main buffer state at that moment is whatever the shell wrote before Claude started — typically just a bare PowerShell prompt.
3. Bytes flow through `pty.onData` → `entry.mirror.write(data)` → the `@xterm/headless` parser. The mirror's visible buffer ends up as just the bare shell prompt; no Claude content present.
4. `pty.onExit` fires → `cleanup(taskId)` → `finalizeMirrorSnapshot(taskId, mirror)`.
5. `finalizeMirrorSnapshot` awaits `mirror.serializeStable()` → serializes the near-empty cell-state → calls `snapshotStore.write(...)`.
6. **`snapshotStore.write` is a `temp-file + rename` ATOMIC OVERWRITE.** Any previously-good snapshot — typically the one `flushMirrorSnapshot` wrote on last-WS-detach (Iterate E ADR-092 path) — is replaced by the 158-byte stub.

The bug was latent in Iterate E's design from day one: any Claude task that clears its terminal on exit hit it. Iterate G's `CLAUDE_CODE_NO_FLICKER=1` default makes the alt-screen leave guarantee an empty main buffer at exit-time, so it now fires on EVERY Claude task that is killed or whose pty idles out.

### Issue 2 — TaskCard Resume button missed in Iterate G's gating

Iterate G gated the Resume CTA on the **TaskDetailHeader**; the equivalent solid-color Resume button on the **TaskCard** in the TaskBoard kanban (rendered by `<TerminalLaunchButton variant="solid" resume>`) was missed. The user sees a Resume button on the card while the Claude session is live; clicking pastes `claude --resume <uuid>` into a shell that is already running Claude — same incorrect behavior the header fix closed.

## Decision

Two scope-bounded fixes; both pragmatic mitigations layered on top of the existing snapshot + CTA architecture.

### F1 — `finalizeMirrorSnapshot` size-comparison heuristic

In `server/src/terminal/pty-manager.ts`, extend `finalizeMirrorSnapshot(taskId, mirror)` with a pre-write check:

1. Call `snapshotStore.read(taskId)` to load any existing snapshot.
2. Compare the new payload's byte length (`stable.length`) against the existing payload's byte length (`existing.data.length`).
3. If `existingDataLen > 0 && newDataLen < existingDataLen * 0.6`, skip the `snapshotStore.write` call. Log a `console.warn` line noting taskId + both byte lengths so the decision is observable.
4. `mirror.dispose` + `releaseQueue` still fire in the `finally` block on every branch.

Edge cases:
- No existing snapshot → write the new one (first writer wins; comparison never fires).
- `snapshotStore.read` throws (malformed header, IO error) → log + write the new one (best-effort fallback; never lose data on read failure).
- New payload is empty (`stable.length === 0`) + existing has content → preserve existing (subsumed by the 60 % rule; documented explicitly).

**Threshold rationale:** a 60 % gate distinguishes "Claude TUI cleared on exit" (typical shrink to ~1–10 % of pre-exit state) from "user deliberately ran `clear` then closed" (typical shrink to ~50–80 %). 50 % would miss legitimate exit-clears; 70 % would over-preserve. 60 % is the documented compromise + the skip-decision is logged so misclassifications surface in observability without a code change.

### F2 — TaskCard Resume liveSession gating

In `client/src/components/external/TaskCard.tsx`, extend the `idle` Resume branch with `task.liveSession !== true`. Mirrors the TaskDetailHeader.ctaFor() pattern from ADR-095:

```tsx
{task.state === "idle" && task.liveSession !== true && (
  <span data-testid={`task-card-resume-${task.taskId}`}>
    <TerminalLaunchButton task={task} variant="solid" color="orange" size="xs" resume={true} />
  </span>
)}
```

`liveSession === undefined` (back-compat — older server response) falls back to surfacing Resume; same conservative default TaskDetailHeader uses.

## Rationale

**Why not the proper root-cause fix (xterm 6.0 upgrade):** xterm.js 6.0's DECSET 2026 support would let us drop `CLAUDE_CODE_NO_FLICKER` and run Claude in normal-screen, eliminating the empty-main-buffer at exit. But the upgrade is a breaking change (windowsMode removed, Canvas renderer removed) AND invalidates the ADR-088 snapshot version pin. A parallel session (Pfad B) is exploring it. ADR-096's heuristic is the **pragmatic mitigation** that protects the snapshot regardless of which TUI clears on exit, not just Claude — content-agnostic + 60 % observable.

**Why a size heuristic vs ANSI sniffing for `DECRST 1049`:** sniffing couples our snapshot logic to a specific Claude Code output convention. A non-Claude TUI (e.g. `htop` or `vim` opened in the embedded terminal, then closed) hits the same alt-screen leave pattern; the size heuristic catches all of them. The 60 % threshold is heuristic + tunable via observability.

**Why TaskCard gating mirrors TaskDetailHeader (inline at the call site, not pushed into TerminalLaunchButton):** the gating is **policy** (whose surface shows what), the button is **mechanism** (render a stylable solid CTA). Mixing them would couple surface-policy to button mechanism.

## Consequences

- `server/src/terminal/pty-manager-live-snapshot.test.ts` (+6 cases, +200 LOC): size-comparison heuristic — large existing + small new preserves existing, threshold edge writes new, no-existing first-writer, read-throws fallback writes new, empty-new + existing preserved, dispose + releaseQueue still fire on the skip branch.
- `client/src/components/external/TaskCard.test.tsx` (+4 cases, +35 LOC): liveSession gating matrix — `idle + liveSession=true` hides Resume, `idle + liveSession=false` shows, `idle + liveSession=undefined` shows (back-compat), `done + liveSession=any` no Resume (state takes precedence at outer `!isDone` gate).
- Server build: tsc clean. Server tests: 933/933.
- Client build: tsc + vite clean. Client tests: 784/784.
- **Empirical test finding:** a fresh `@xterm/headless` 120x30 mirror after a single `__emit("$ ")` serializes via M2 stable pipeline to ~2–27 bytes. This confirms the 60 % heuristic correctly identifies "Claude exited + main buffer is almost empty" against the typical 1–3 KiB cell-state of an active Claude conversation.
- The user's reported task `5124b107-2649-4edb-b0a5-b45873ebae82` would have been recovered IF `flushMirrorSnapshot`-on-last-detach (Iterate E ADR-092) had fired before the idle-ceiling triggered `finalizeMirrorSnapshot`. The heuristic protects forward.

## External Plan Review / Code Review Cascade / Confidence Calibration

ALL SKIPPED — runner contract gates require medium+ or risk flag. Iterate H is complexity=small per the spec frontmatter with no risk flags; total diff ≈90 LOC source + ≈250 LOC test additions, below the cascade gate. Self-Review is the only review per runner contract.

## Self-Review (7-item canonical checklist)

1. **Spec Compliance** — PASS: both AC blocks covered with all edge cases.
2. **Error Handling** — PASS: `snapshotStore.read` failures logged + fall through to write (best-effort; never lose data). `finally` block preserved on every branch.
3. **Security Basics** — PASS: no new I/O surface; no user-controlled paths; `SnapshotStore.validateTaskId` continues to gate every public read/write.
4. **Test Quality** — PASS: 10 new unit tests (6 server + 4 client) covering decision boundaries.
5. **Performance Basics** — PASS: one extra `snapshotStore.read` per pty death is a single file-open of a ≤4-KiB snapshot; ~1–5 ms added.
6. **Naming & Structure** — PASS: changes live inside the existing `finalizeMirrorSnapshot` method.
7. **Affected Boundaries (ADR-024)** — PASS: no serialized-format change (snapshot file's `header + payload` shape is byte-identical; the heuristic is single-writer self-check).

## Falsifiability

If operator UAT post-merge confirms a fresh Claude task that gets killed STILL shows an empty terminal on return, the size-heuristic hypothesis is falsified — possible failure modes: (a) the mirror.serializeStable output is comparable in size to the existing snapshot, or (b) `flushMirrorSnapshot` on last-detach didn't fire. If users miss the Resume button on a TaskCard in the rare "shell-back-but-pty-alive" sub-case, an Iterate H' could surface a "Stop terminal session" CTA on the card itself.

## Rejected Alternatives

1. **Periodic snapshot-on-buffer-quiesce writer** — significantly more complex; same outcome via existing `flushMirrorSnapshot` on last-detach + this iterate's refuse-to-shrink-overwrite.
2. **Hard-gate finalize: always preserve any existing snapshot** — prevents updates in legitimate cases (user ran `clear` then exited).
3. **Threshold at 50 % / 70 %** — 50 % too permissive; 70 % too restrictive. 60 % is the compromise.
4. **Sniff post-exit ANSI for `DECRST 1049` specifically** — couples snapshot logic to Claude Code's specific exit convention; size heuristic is content-agnostic.
5. **Push the TaskCard gating into TerminalLaunchButton** — couples policy to mechanism.

## Files modified

`server/src/terminal/pty-manager.ts`, `server/src/terminal/pty-manager-live-snapshot.test.ts` (+6 cases), `client/src/components/external/TaskCard.tsx`, `client/src/components/external/TaskCard.test.tsx` (+4 cases), `.shipwright/planning/iterate/2026-05-13-H-snapshot-preservation-taskcard-gating.md` (NEW iterate spec).
