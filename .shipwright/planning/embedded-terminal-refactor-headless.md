# Embedded Terminal Refactor — Cell-State Snapshots via @xterm/headless

Status: APPROVED 2026-05-11. Execution begins with Iterate A.

**Decisions locked:**
- Resize-drift fix: **M2 (server-side double-serialize)** — ~10 ms per attach, drift eliminated. Backed by spike T2 fixed-point.
- Snapshot format: **Plain text + 1-line header** (`# shipwright-snapshot v1 xterm@<ver> cols=<n> rows=<m>`).
- Privacy: **Default-on, updated disclosure copy**. Existing 24 h TTL + `0600` mode retained.
- Migration: **No migration** — no historical user history exists yet. Cleanup deferred to Iterate C: one-shot wipe of `<scrollbackDir>/*.log*` at first boot after Iterate C deploy (replaces the 24 h TTL-natural-decay path; cleaner cut).
- Iterate granularity: **Three iterates A / B / C** as planned below.

Authored: 2026-05-11. Inputs: codex architecture review + two empirical spikes against the real captured scrollback at
`C:/Users/you/.shipwright-webui/terminal-scrollback/2aa752d7-e9c1-43df-a6b7-ca3ca9bb19aa.log`.

## Why

Four iterates (v0.9.1 → v0.9.4; ADR-069, ADR-077, ADR-079, ADR-086) have each added another workaround on top of the
byte-stream disk-scrollback persistence chosen in ADR-069. Claude Code's TUI redraws main-buffer state with raw cursor-
position bytes; only a real terminal emulator can preserve that faithfully. Every workaround is a symptom of the same
architectural mismatch:

| ADR | Workaround | Underlying problem |
|---|---|---|
| 069 | Sanitizer strips cursor-control bytes from disk scrollback | Raw bytes re-execute on replay |
| 077 | Replay-time collapse of repeated PowerShell startup banners | Same boilerplate persisted N times across pty respawns |
| 079 | Pushdown banner-grace + grow-rows-on-attach in client | Replay corrupts the visible buffer when alt-screen wasn't entered |
| 086 | Skip-replay-for-new-plain entirely | Claude TUI in main buffer = unreadable replay; emergency mitigation |

The correct primitive is the same one VS Code uses for `terminal.integrated.persistentSessionScrollback`: a server-side
`@xterm/headless` Terminal instance that mirrors each pty, with `@xterm/addon-serialize` producing a cell-state snapshot
on attach. The snapshot replays into the client's xterm.js in a single `term.write()` call.

## Empirical evidence (spike runs)

Two spikes were run in `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/`. All against the real 30 986-byte
captured Claude TUI scrollback. Memory cost across multiple in-scope terminals stayed under 80 MB RSS.

### Spike v1 — round-trip equality (byte-exact)

| Variant | Chunks | Ingest | Serialize | Byte round-trip |
|---|---|---|---|---|
| Random chunking (1–1024 B) | 59 × ~525 B | 799 ms | 6 ms | **PASS** (25 395 B exact) |
| Mid-escape splits (forced 4-byte fragmentation) | 6 892 × 4 B | 96.9 s* | 4 ms | **PASS** (25 395 B exact) |
| Resize 120×30 → 80×24 mid-stream | 62 × ~500 B | 884 ms | 2.6 ms | **FAIL** at offset 9 075 (size matches) |

\* Per-write callback overhead under pathological fragmentation; production chunks are KB-sized.

### Spike v2 — resize drift, visible-buffer comparison

Spike v2 compared `term.buffer.active.getLine(y).translateToString(false)` line-by-line — the rendered cell state, not
the synthesized serialize byte stream.

| Test | Outcome |
|---|---|
| T1: Plain resize-midway, visible compare | FAIL — 1 line (273/443) differs: mirror=blank, replay=`-` at col 0 |
| T2: Fixed-point — serialize→replay→serialize→replay→serialize | round1≠round2 (FAIL), **round2==round3 (PASS)** |
| T3: Segmented replay (raw post-resize bytes) | PASS — but not a real snapshot test |
| T4: Resize-replay-too (split serialized at resize) | pre PASS, post FAIL (same drift) |
| T5: **Production design simulation** (live mirror, attach-time serialize, client write) | FAIL — same 1-character drift |

**Headline finding (T2):** the drift converges after a single round-trip. `serialize → write-back → serialize` is
idempotent. The first replay introduces a 1-char artifact; subsequent serializations are byte-stable.

**Resize-drift magnitude (T5, production scenario):**

```
y=271  ────────────────────────────────────────────────────────────  (identical)
y=272  ───────────  Rewind                                            (identical)
y=273  M=blank,  C=`-` then 79 spaces                                 ← only diff
y=274                   Nothingtorewindtoyet.Esctocancel              (identical)
y=275                                                ──────────────   (identical)
```

One dash glyph at column 0 of an otherwise-blank dialog line. Visible, deterministic, low-impact.

## Resize-drift mitigation — strategy decision required

Three options; **pick one before Iterate A begins**.

### M1 — Ship as-is, accept 1-char drift

- Cost: zero
- Risk: visible-but-deterministic artifact; user may report it as a regression vs current architecture
- Compared to status quo: current byte-stream replay is **unreadable** on Claude TUI; M1 leaves **1 dash**
- Verdict: defensible. Recommend if user values shipping over polish.

### M2 — Server-side double-serialize (recommended)

Backed by T2: round2 == round3.

```ts
// In headless-mirror.ts attach path:
const raw = serializeAddon.serialize();          // round1 — drifts
const warm = new Terminal({ cols, rows, scrollback });
const warmSer = new SerializeAddon();
warm.loadAddon(warmSer);
await new Promise(r => warm.write(raw, r));
const stable = warmSer.serialize();              // round2 == round3 — stable fixed point
// Send `stable` to client.
warm.dispose();
```

- Cost: ~10 ms per attach (one extra parse + serialize cycle)
- Spike-proven: round2 == round3 (PASS)
- Memory: one transient Terminal per attach, disposed immediately
- Verdict: **recommended.** Eliminates the visible drift entirely; cost is negligible against attach latency budgets.

### M3 — Avoid resize during mirror lifetime

Pin headless mirror at the client's current cols/rows at task creation; on client-side resize, dispose and recreate
mirror from saved snapshot at new dims. Complex; not justified by the spike evidence.

## Architecture invariants (frozen by codex review)

1. **Headless mirrors only for LIVE ptys.** Idle/completed tasks persist only the serialized snapshot on disk, not a
   live Terminal instance. Active-task-cap or LRU eviction policy enforced in headless-mirror manager.
2. **`@xterm/headless` is CJS.** Wire via `import pkg from "@xterm/headless"; const { Terminal } = pkg;` in the server's
   ESM code. Verified in the spike.
3. **`term.write(data, callback)` MUST be awaited before serialize.** The parser is async-ish; serializing immediately
   after a batch can capture incomplete state. Verified in the spike — without await, mid-escape-split tests would fail.
4. **Snapshot version must be pinned.** `@xterm/addon-serialize` output format is not guaranteed stable across xterm
   minor versions. Pin via exact `dependencies` (no `^`); embed `terminalVersion` header in the snapshot envelope.
5. **Plan-D″ (ADR-034) unaffected.** Headless parses pty output; never spawns Claude. ADR-068-A1 Decision 5
   (client-side WS data-frame auto-launch) is unchanged — input semantics are not touched.
6. **No tracked-file write inside this planning phase.** The plan lives under `.shipwright/planning/` which is gitignored;
   conversion to ADR + implementation lands in iterate A.

## Iterate A — Headless mirror behind feature flag

**Goal:** Introduce server-side `@xterm/headless` mirror per live pty. Persist serialized snapshot per task. No
client-side change yet.

**Feature flag:** `SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=1` — default OFF in iterate A; default ON in iterate B.

**New files:**

- `server/src/terminal/headless-mirror.ts` — Per-task `@xterm/headless` Terminal lifecycle. Reads cols/rows from pty;
  feeds `pty.onData` bytes via `term.write(data, callback)`. Exposes `serializeStable(): Promise<string>` (applies M2
  double-serialize). Disposable.
- `server/src/terminal/snapshot-store.ts` — Disk persistence for snapshots. Atomic write (temp + rename). Per-task
  `<scrollbackDir>/<taskId>.snapshot`. Versioned header (`# shipwright-snapshot v1 xterm@5.5.0 80x24`).
- `server/src/terminal/__tests__/headless-mirror.fixture.test.ts` — Reuses the captured 30 986-byte log + the four spike
  variants as fixtures. Asserts visible-line equality via `getLine().translateToString(false)`.

**Modified files (minimal):**

- `server/src/terminal/pty-manager.ts` — On spawn, if flag set, create headless mirror; subscribe pty.onData to mirror.
  On kill, dispose mirror + finalise snapshot to disk.
- `server/src/terminal/routes.ts` — No protocol change. Scrollback-store path remains primary. Snapshot-store writes
  shadow alongside.

**Acceptance criteria:**

1. Flag OFF: zero behavior change. Existing E2E suite green.
2. Flag ON: each task with active pty writes both legacy scrollback bytes AND a snapshot file. Snapshot exists on disk
   at task end. No regression in CPU/RAM/disk metrics (compare baseline run vs flag-on run).
3. Fixture test green: visible-line equality between mirror state and re-replayed snapshot for: random chunks,
   mid-escape splits, resize-midway (with M2 double-serialize). Real 30 986-byte log used as input.
4. Snapshot file has versioned header; loader rejects unknown versions with a clear error.
5. Memory governance: at most N live mirrors (where N = active-task-count from pty-manager); idle tasks have no
   in-memory Terminal instance.

**Estimate:** 3–4 days. Mostly straightforward; fixture test is the chokepoint.

**Risks:**

- `@xterm/headless` running under `@hono/node-server` — verify no DOM polyfill required. Spike showed Node 24 + ESM
  works with a CJS interop shim; document this in the new file's header.
- `TERM=dumb` (set deliberately on pty spawn for the chalk brand-color hack — `createNodePtySpawnFn`) does not affect
  headless parsing; headless interprets the byte stream regardless of `TERM`.

## Iterate B — Replace replay protocol

**Goal:** Change WS attach replay from chunked raw scrollback to single snapshot envelope. Default flag flip.

**New WS envelope (server → client):**

```ts
type WSReplaySnapshot = {
  type: "replay_snapshot";
  data: string;         // Serialized cell-state from `serializeStable()`
  cols: number;
  rows: number;
  terminalVersion: string;  // e.g. "@xterm/headless@5.5.0"
};
```

**Modified files:**

- `server/src/terminal/routes.ts` — WS upgrade replay branch reads from snapshot-store (instead of scrollback-store
  `readForReplay`). Emits single `replay_snapshot` envelope. Falls back to legacy chunked path if snapshot missing or
  version mismatch.
- `client/src/hooks/useTerminalSocket.ts` — Handle `replay_snapshot`. Pass to consumer.
- `client/src/components/terminal/EmbeddedTerminal.tsx` — On `replay_snapshot`, call `term.write(snapshot.data)` once
  (matches the M2 contract — snapshot was already stabilized server-side, so client's `term.write` produces the same
  cell state). No banner-grace, no pushdown, no skip-replay.

**Real-browser smoke tests (mandatory per "real-browser-smoke-needed" memory):**

Playwright tests against actual rendered xterm.js DOM for:

1. New-plain Claude TUI: launch, paste prompt, observe ~30 lines of Claude output, refresh page (= re-attach), confirm
   visible content matches pre-refresh state line-by-line.
2. Plain shell: run several commands, refresh, confirm prompt + output preserved.
3. Completed task replay-only mode (done / launch_failed state): WS opens, snapshot envelope delivered, WS closes
   cleanly.
4. Resize mid-session: open task, resize browser → triggers cols/rows change, continue, refresh, confirm content
   intact.

**Acceptance criteria:**

1. Client never receives `replay_chunk` envelopes for tasks created in iterate B (legacy fallback for old tasks only).
2. Visible buffer post-attach matches mirror's visible buffer line-by-line (M2 ensures this).
3. Flag flipped: `SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=1` default in `config.ts`.
4. All four real-browser smoke tests pass on Windows ConPTY + macOS pty + Linux pty.

**Estimate:** 3–4 days. Real-browser smoke is the chokepoint.

**Risks:**

- Multi-tab attach: snapshot is per-task, not per-conn — both tabs receive the same snapshot. No new race vs current
  architecture.
- Writer-promoted re-attach: replay envelope sequence runs anew on every attach. Cost = 10 ms double-serialize per
  attach; should be acceptable.

## Iterate C — Retire compensations

**Goal:** Remove the four workarounds. Reduce terminal/ subtree by ~30 % LOC.

**Files deleted:**

- `server/src/terminal/scrollback-sanitizer.ts` (entire file — ADR-069 supersession)
- `collapsePowerShellBoilerplate` + `SHELL_STOPPED_MARKER_RE` + `BANNER_BURST_RE` from `scrollback-store.ts`
  (ADR-077 supersession)
- `readForReplay()` method on `ScrollbackStore` — callers switch to `snapshot-store.read()`

**Files modified:**

- `server/src/terminal/routes.ts` — Remove `skipReplayForNewPlain` branch (ADR-086 supersession); remove legacy
  chunked-replay path entirely (deprecated in iterate B).
- `client/src/components/terminal/EmbeddedTerminal.tsx` — Remove pushdown banner-grace + safeFit dimensions-stub
  (ADR-079 supersession).
- `client/src/hooks/useTerminalSocket.ts` — Remove `replay_chunk` / `replay_separator` / `replay_end` envelope handling.

**ADR work:**

- New ADR-087 (or next number): "Cell-state snapshots supersede byte-stream scrollback". Records the decision, the
  spike empirical evidence, M2 mitigation, and formally supersedes ADR-069, ADR-077, ADR-079, ADR-086.
- Mark ADR-069, ADR-077, ADR-079, ADR-086 status as "Superseded by ADR-087".

**Tests removed:**

- Sanitizer unit tests (entire file)
- Collapse unit tests (subset of scrollback-store tests)
- ADR-086 skip-replay-for-new-plain unit test

**Acceptance criteria:**

1. Terminal subtree LoC reduced by ≥ 25 %.
2. All four real-browser smoke tests from iterate B remain green.
3. `npm run test` + `npm run typecheck` + `npm run lint` clean.
4. external_review.py code pass: no HIGH findings on the diff.
5. ADR-087 merged before this iterate's PR closes.

**Estimate:** 2–3 days. Mostly deletion; ADR work + final E2E is the chokepoint.

## Cross-cutting concerns

| Concern | Resolution |
|---|---|
| Resize-drift mitigation | M2 (server-side double-serialize). Decided in iterate A. |
| Snapshot version stability | Pin `@xterm/headless` + `@xterm/addon-serialize` to exact versions (no `^`); embed version in snapshot header; reject unknown versions on load |
| Memory governance | Active-task cap = pty-manager's active-task list. Idle/completed tasks hold no live Terminal. LRU not required if pty-manager already caps live ptys. |
| Privacy | Snapshots are MORE recoverable than sanitized text. Update disclosure UI in iterate B: explicitly state "captures terminal screen content at the moment of disconnection". Existing 24-h TTL + 0600 file mode retained. Consider explicit user opt-in via env flag (`SHIPWRIGHT_TERMINAL_SNAPSHOT_ENABLED=0` to disable). |
| Failure mode (snapshot write fails) | Warn + continue; never crash the broadcaster. Same policy as scrollback-store. Client falls back to "no replay" (blank terminal with live shell). Logged structured event for observability. |
| Cross-platform | Windows ConPTY + macOS native pty + Linux native pty all emit similar byte streams; headless parses identically. Spike verified Windows specifically. |
| Plan-D″ compatibility | Unaffected. Headless observes; never spawns. ADR-067 shell whitelist remains the architectural enforcement line for spawn targets. |

## Open questions — RESOLVED 2026-05-11

All five open questions were resolved before iterate A start; see the locked decisions in the status header at the top
of this document. The legacy-migration question specifically: no historical user history exists, so no migration is
needed; iterate C does a one-shot wipe of `<scrollbackDir>/*.log*` at first boot after deploy.

## Spike artefacts

- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/spike.mjs` — v1 round-trip test
- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/spike-v2.mjs` — v2 resize-strategy tests
- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/output.txt` — v1 run log
- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/output-v2.txt` — v2 run log
- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/serialized-*.txt` — captured snapshots per variant
- `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/roundtrip-*.txt` — replay results per variant
