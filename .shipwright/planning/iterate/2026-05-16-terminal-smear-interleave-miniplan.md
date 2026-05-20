# Mini-Plan: terminal-smear-interleave

- **Run ID:** iterate-20260516-terminal-smear-interleave
- **Branch:** `iterate/fix-terminal-smear-interleave` (from `main`)

> **Checkpoint note (2026-05-16):** the renderer-probe scaffolding has already
> been reverted and `terminal-bisect/` deleted — the branch starts from clean
> `main`. The "Files" rows for `package.json` / `vite.config.ts` and
> work-breakdown step 4 (probe removal) are therefore PRE-DONE. The build is
> the drain gate + the ADR-099 atlas-machinery deletion only.

## Approach

Client-side **replay drain gate** in `EmbeddedTerminal.tsx`. The gate already
exists in embryo as `replaySnapshotInFlightRef` (true while the `replay_snapshot`
`term.write` parses) — today it only suppresses the (being-deleted) atlas
burst-trigger. Extend it to gate the live-`data` write path:

1. New refs:
   - `replayDrainQueueRef = useRef<string[]>([])` — buffers live chunks.
   - `replayDrainQueueBytesRef = useRef(0)` — running byte total for the cap.
   - `replayGenerationRef = useRef(0)` — monotonic gate-instance token; the
     completion callback + watchdog capture it at arm-time and no-op if stale.
   - `replayWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)`.
2. `onData`: keep the prompt-readiness bookkeeping (`dataSeenInitiallyRef`,
   `lastPtyDataAtRef`) UNCONDITIONAL — data did arrive on the wire (these feed
   the ADR-068-A1 auto-launch handshake, a wire-receipt concept, not "rendered").
   Then: if `replaySnapshotInFlightRef.current` → enqueue (push chunk, add its
   byte length; if the total exceeds `REPLAY_DRAIN_MAX_BYTES`, shift oldest
   chunks off until under the cap — gate stays CLOSED, never a concurrent
   write); else → `term.write(chunk)` as today.
3. `onReplaySnapshot`: at the START of the handler — bump `replayGenerationRef`,
   clear the queue + byte counter (a fresh snapshot is authoritative — live
   data queued for a prior snapshot window is superseded and dropped), clear
   any prior watchdog, set `replaySnapshotInFlightRef = true`, arm a fresh
   watchdog. In the `term.write(snapshot, cb)` completion callback: if the
   captured generation is stale → no-op; else drain via a SINGLE concatenated
   write (`term.write(queue.join(""))` — single-threaded, no interleave), reset
   the queue + byte counter, clear the watchdog, set
   `replaySnapshotInFlightRef = false`.
4. Safety (AC-3 / AC-5 — gate must never deadlock, OOM, or release via a
   concurrent write):
   - **generation token** — callback + watchdog both capture
     `replayGenerationRef.current` at arm-time; a stale generation makes the
     action a no-op. Closes the callback-fires-after-watchdog double-drain race.
   - **disposed** early-return path in the callback → release flag + clear
     queue (term is gone — drop).
   - **synchronous-throw `catch`** around `term.write(snapshot)` → release
     flag + clear queue + clear watchdog.
   - **watchdog** — one-shot `setTimeout(REPLAY_DRAIN_TIMEOUT_MS = 5000)` armed
     when the gate closes: on fire (only if the generation is still current)
     force-release via the same single concatenated drain. Defends the
     xterm-drops-callback case.
   - **byte cap** `REPLAY_DRAIN_MAX_BYTES` (8 MiB): overflow drops the OLDEST
     queued chunks (ring-buffer trim); the gate stays closed. Never a
     force-drain mid-flight — the external review HIGH finding established that
     force-draining concurrently re-creates the exact smear. Worst case under a
     pathological burst: a small gap in mid-stream output, never corruption.
   - watchdog/overflow diagnostics log chunk **counts + byte sizes only**,
     never chunk contents (PTY data may contain secrets).
   - taskId-change effect + mount effect + unmount cleanup reset the flag,
     the queue + byte counter, bump the generation, and `clearTimeout` the
     watchdog.

The renderer is empirically excluded — production stays on WebGL, loaded
unconditionally (no probe, no ref kept).

## Files

| File | Change |
|---|---|
| `client/src/components/terminal/EmbeddedTerminal.tsx` | + drain gate; − ADR-099 atlas machinery; − renderer probe |
| `client/src/components/terminal/EmbeddedTerminal.test.tsx` | + drain-gate tests; − atlas tests (AC-2/AC-3 old); − canvas mock |
| `client/package.json` | − `@xterm/addon-canvas` dep + `overrides` block |
| `client/package-lock.json` | regenerated via `npm install` |
| `client/vite.config.ts` | − addon-canvas `resolve.alias` |
| `terminal-bisect/` | deleted (untracked throwaway harness) |

## Work breakdown (TDD)

1. Branch `iterate/fix-terminal-smear-interleave` from `main`.
2. RED — rewrite the replay section of `EmbeddedTerminal.test.tsx`:
   - keep AC-1 (`replay_snapshot` → reset + write(data,cb) + scrollToBottom-in-cb).
   - delete the two atlas tests ("onWriteParsed … atlas maintenance",
     "synchronous term.write throw … atlas maintenance").
   - add drain-gate tests covering the full race matrix (AC-1..AC-5):
     queue-during-flight, drain-in-order (single concatenated write),
     straight-through (no replay in flight), synchronous-throw release,
     dispose-before-callback, watchdog-fires-before-callback,
     callback-fires-after-watchdog (stale generation = no-op, no double
     drain), second-snapshot-during-drain (queue cleared + re-armed),
     byte-cap overflow (oldest dropped, gate stays closed). Assert final
     queue + gate state, not only `writeSpy` call order.
   - remove the `@xterm/addon-canvas` `vi.mock`; trim now-dead mock surface
     (`clearTextureAtlas`, `onWriteParsed`/`fireWriteParsed`, `onScroll`,
     `refresh`) only where no surviving test needs it.
   - run → new tests FAIL.
3. GREEN — implement the drain gate in `EmbeddedTerminal.tsx`; delete the
   ADR-099 atlas machinery (`safeAtlasMaintenanceRef`, the `if (webglRef &&
   atlasMaintenanceEnabled)` block, all 4 ADR-099 constants, the timer/
   listener cleanup, the auto-launch `setTimeout(4_000)` post-launch-settle);
   delete the probe scaffolding (`readProbeSwitch`, `?renderer/?rescale/
   ?atlasMaintenance`, the canvas branch + import, `__embeddedTerminalWebglAddon`
   expose, the console.log); revert `rescaleOverlappingGlyphs` to `true`;
   WebGL loaded unconditionally (no ref kept).
4. Remove the addon-canvas dep + `overrides` (`package.json`), the vite alias,
   `terminal-bisect/`; `npm install` to regenerate the lock.
5. `npm run build` + full client test suite green.
6. F0.5 — Playwright: the ADR-092 regression guard
   `v0-9-6-live-pty-replay.spec.ts` still passes; add a drain-gate E2E
   asserting buffer integrity after an interleaved reattach.

## Test strategy

- Unit (`EmbeddedTerminal.test.tsx`, jsdom + xterm mock): the drain gate is
  fully observable via `writeSpy` call order + the deferred `writeCompletions`
  harness already in the file. Assert: live `data` is absent from `writeSpy`
  until `flushWriteCompletions()`, then present in arrival order after the
  snapshot payload.
- E2E (Playwright, real stack): reattach to a task with live pty output;
  assert `term.buffer.active` text contains no stray left-column fragments
  (renderer-independent — the corruption is in the buffer model, so a buffer
  assertion is valid and screenshot-free).

## Alternative considered

Server-side: delay `flushLiveBuffer()` until the client ACKs snapshot
completion (new WS message type). Rejected — crosses the client/server
boundary, needs a protocol addition, and the fix is cleanly client-side
(the snapshot bytes are already correct). See iterate ADR.

## External Review Integration (2026-05-16)

External LLM review (openrouter, gemini + openai, 16 findings) run against
this spec + mini-plan before build. Dispositions:

- **HIGH — overflow handler re-creates the bug.** The original "force-drain
  everything + release" on `REPLAY_DRAIN_MAX` overflow would issue concurrent
  writes while the snapshot is still in flight = the exact smear. **Adopted:**
  byte-capped queue (`REPLAY_DRAIN_MAX_BYTES` = 8 MiB), drop oldest chunks on
  overflow, gate stays closed (user-confirmed policy). Spec AC-3 + mini-plan
  Approach step 4 rewritten.
- **MED — drain via single concatenated `term.write`** instead of an N-chunk
  write loop. Adopted (Approach step 3).
- **MED — clear the queue on new-snapshot arrival.** A reattach snapshot
  supersedes prior queued live data. Adopted; AC-5 semantics pinned.
- **MED — generation token** so a late completion callback and the watchdog
  cannot double-drain. Adopted (Approach step 4, `replayGenerationRef`).
- **MED — expand RED tests** to the full race matrix. Adopted (work
  breakdown step 2).
- **LOW — verify E2E `term.buffer.active` hook** survives the probe-expose
  deletion; repo-wide grep for `addon-canvas` before removal; log
  counts/sizes only (no chunk contents); mark ADR-099 Superseded at F3;
  audit `dataSeen*` consumers. All folded into the work breakdown / F3.
