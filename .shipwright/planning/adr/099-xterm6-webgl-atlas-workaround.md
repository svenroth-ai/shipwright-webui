# ADR-099 spec — Iterate K: xterm.js 6.0 WebGL atlas-corruption workaround + addon-serialize SGR-encoding fix (v1 → v8)

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-099.
**Status (current):** superseded by ADR-108.
**Status (historical):** accepted.
**Date:** 2026-05-14.
**Campaign:** `codex-rescue-altscreen-rendering`, Iterate K.
**Type:** fix (client-side rendering workaround + server-side replay-envelope SGR re-emit).
**Complexity:** medium.
**Risk flags:** none (pure-frontend rendering layer + additive server snapshot field).
**Branch:** `iterate/codex-rescue-altscreen-rendering`.

## Supersession status

The WebGL atlas-maintenance machinery (`clearTextureAtlas` / `refresh` / `onScroll` / `onWriteParsed` / `wheel` / periodic-clear) was DELETED by ADR-108. The renderer-bisect probe (iterate-20260516-terminal-smear-interleave) empirically ruled out the GPU atlas as the smear cause (WebGL AND DOM renderers both smeared); the real cause was a client-side replay/live-data write interleave, fixed by the ADR-108 replay drain gate. The `__embeddedTerminalWebglAddon` test-handle export and the 3 `probe-iterate-k-*.mjs` harnesses were removed with it.

The SGR-encoding mouse-mode re-emit on the server (`buildReplaySnapshotEnvelope`) is unrelated to the atlas workaround and continues to stand.

## Extended Context

Two upstream bugs in the xterm.js 6.0.0 stack manifest on every sustained Claude Code TUI session in the embedded terminal pane:

1. **`xtermjs/xterm.js#5847` — WebGL texture-atlas merge corruption** (open, milestone 7.0). The WebGL renderer's atlas page accumulates duplicate cache entries and coordinate drift during sustained per-cell color-attribute streaming (precisely Claude TUI's emit shape: `\x1b[38;5;…m` runs separated by `\x1b[1C` cursor-rights at per-word granularity). Symptom: visible smearing / ghosting / glyph substitution on rows with ANSI color, recovered ONLY by atlas-clear, resize, or remount. VS Code's `forceRedraw()` (xtermTerminal.ts:600) is the same workaround but fires only on OS resume because their workload triggers the bug less often.
2. **`@xterm/addon-serialize` 0.14.0 — mouse-encoding mode not serialized.** When the user attaches mid-session, the `replay_snapshot` envelope (ADR-087) replays cell-state via `addon-serialize` but the addon's output does NOT include the `?1006h` / `?1000h` / `?1002h` SGR private modes Claude TUI has enabled. Symptom: after re-attach, mouse-wheel events go to xterm's native scroll-viewport instead of being forwarded to Claude as mouse-reports.

Both surfaces feed into the same user-visible symptom class ("Verschmierungen / smearing / stale-cursor-ghosting after Resume / mouse-wheel after detach goes to the wrong place"). ADR-099 bundled them because the v1–v8 iteration on the WebGL workaround was driven by what the SGR-re-emit fix did NOT cover: even with mouse modes restored, the atlas itself stayed corrupted across the snapshot replay and needed an explicit `clearTextureAtlas()` to be recoverable.

## Decision

1. **Server-side:** `server/src/terminal/replay-snapshot.ts buildReplaySnapshotEnvelope` re-emits `\x1b[?1006h` (and `?1000h` / `?1002h` when detected as enabled on the headless mirror) at the end of the serialized payload. Same byte-stream contract as ADR-087's snapshot envelope; the version-gate stays at v2. **(Survives ADR-108.)**
2. **Client-side rendering workaround in `client/src/components/terminal/EmbeddedTerminal.tsx`** — eight-revision evolution converging on a *buffer-type-aware, activity-gated, multi-trigger* atlas-maintenance pass. The single function (`safeAtlasMaintenance()`) ran `webglRef.clearTextureAtlas()` + `term.refresh(0, rows-1)` in main-buffer, `term.refresh(0, rows-1)` ONLY in alt-screen. The triggers were:
   - **Periodic 10 s interval**, gated by `writesSinceLastClear > 0`.
   - **`term.onScroll`** (content-driven scroll only).
   - **`term.onWriteParsed` burst-after-2-s-quiet** (catches Resume / re-attach / wake-up).
   - **Post-mount settle backstop at +3 s**.
   - **DOM `wheel` listener with 150 ms debounce** (v8 — user-initiated scroll catches cases where xterm's `onScroll` is silent because mouse-capture mode has been re-emitted from ADR-099 server-side).
3. **WebGL addon load order**, already merged via PR #12 (`cd6b9f7`): `term.loadAddon(webglRef)` BEFORE `term.open(container)` (the DOM renderer never initialises) + `rescaleOverlappingGlyphs: true` (xterm.js#5100). Cross-referenced against xterm.js demo, siteboon/claudecodeui, microsoft/vscode.

**(Items 2 + 3 were deleted by ADR-108.)**

## Eight-revision client-side evolution

Commits on `iterate/codex-rescue-altscreen-rendering`:

| v | Commit | What | Why this wasn't enough |
|---|---|---|---|
| v1 | `bd9e3ea` | 30 s periodic `clearTextureAtlas` + `term.onScroll` immediate | Smearing built up within window |
| v2 | `4e8f938` | 10 s periodic + `term.refresh()` after clear | Periodic flicker fired even when idle |
| v3 | `f0ce31a` | Conditional via `onWriteParsed` counter (skip when idle) | Alt-screen heavy-flicker on every clear (superimposed on Claude's per-frame redraw) |
| v4 | `bf7b05f` | Skip `clearTextureAtlas` in alt-screen | Stale cursor stayed in alt-screen with no refresh |
| v5 | `e9aa804` | Split: main = full clear+refresh, alt = refresh-only | "Resume nicht greift" when snapshot-replay was bundled with the burst |
| v6 | `104435b` | Burst-after-2-s-quiet trigger via `onWriteParsed` | Post-fresh-mount the gate `lastWriteTime > 0` excluded the very first write batch |
| v7 | `e01bae9` | Pre-init `lastWriteTime` to mount-time minus quiet+1 ms + post-mount settle backstop at +3 s | `term.onScroll` silent on user-wheel during mouse-capture; smearing on scroll-while-streaming |
| v8 | this commit | DOM `wheel` listener on `containerRef.current`, 150 ms debounce, bubble-phase passive | Resume-click-in-long-mounted-tab still missed: typing echo defeats burst-trigger; postMountSettleTimer long expired |
| v9 | follow-up | Post-launch-settle: one-shot maintenance at +4 s after every `coord.consumeLaunch` (cross-effect bridge via `safeAtlasMaintenanceRef`) | (Empirical anchor: user UAT "es hat resume nicht gegriffen, erst nach 10s gut", 2026-05-14) |

Plus, off-band: `814620c` server-side `?1006h` re-emit (the SGR fix), `05724ca` Vite WS-proxy hardening (swallow ECONNRESET/ECONNABORTED/EPIPE), `84c014c` cherry-pick of the D-e2e task-type matrix spec.

## Empirical Evidence (v8 systematic Playwright probe, 2026-05-14)

Headed probe `client/e2e/probe-iterate-k-scenarios.mjs` ran 10 scenarios (S1–S10) against three live tasks on a Tailscale-attached dev stack. Spies (`WebglAddon.prototype.clearTextureAtlas` + `Terminal.prototype.refresh`) were installed via `page.addInitScript` property-setter accessors on `window.__embeddedTerminal*` so the very first maintenance pass triggered by the mount-effect's snapshot-replay write was captured.

| Task | State | Critical findings |
|---|---|---|
| `4a9fe7f2…` Claude /goal | active, alt-screen | S1 post-mount: 1 clear + 58 refresh (mostly `alternate`). S6 idle 25 s: **0 events**. S3 5-wheel-burst: 2 events (debounce coalesced ~5×→2). |
| `58be94c5…` Tool Tips 2 | done (replay-only) | 17 176 total events over 62.8 s. **`altClears == 0`** held across ALL 17 176 events — strongest empirical proof of the alt-screen invariant. (Anomalous ~290 refresh/sec rate is pre-existing replay-only WS-reconnect-loop behaviour; not v8-related.) |
| `810efeca…` Claude Design | active, alt-screen | S6 idle 25 s: **0 events**. S3 5-wheel: 36 events (33 background + 3 from wheel). S9 single wheel during mouse-capture: 6 events (handler fires through mouse-capture). |

Cross-task aggregate: `altClears == 0` for every task — the buffer-type-aware split was mechanically airtight.

## References

- `xtermjs/xterm.js#5847` (WebGL atlas merge corruption, milestone 7.0).
- `xtermjs/xterm.js#5100` (`rescaleOverlappingGlyphs`).
- `xtermjs/xterm.js#5620` (Claude / AI-CLI scrollbar shake).
- `xtermjs/xterm.js#3864` + `#3201` (`onScroll` semantics).
- `microsoft/vscode src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts:600` `forceRedraw` pattern.
- `Eugeny/tabby tabby-terminal/src/frontends/xtermFrontend.ts` DOM wheel/keyboard listener pattern.
- `siteboon/claudecodeui src/components/shell/hooks/useShellTerminal.ts:87-104` reference order-of-init.
- `xtermjs/xterm.js demo/client/client.ts:342-354` canonical demo addon-load-order.

## Consequences

- `client/src/components/terminal/EmbeddedTerminal.tsx` (~50 LOC across v1–v8 evolution, ~25 LOC for v8 wheel listener including comment block + cleanup + test-handle export). **Deleted by ADR-108.**
- `server/src/terminal/replay-snapshot.ts` (~10 LOC for the SGR re-emit branch — `814620c`). **Survives.**
- `client/e2e/probe-iterate-k-scenarios.mjs` (NEW, ~280 LOC) — Playwright headed probe. **Deleted by ADR-108.**
- `client/playwright-report/iterate-k-v8/` (probe artefacts: per-task `atlas-log.json` + screenshots + `results.json`).
- 40/40 client terminal tests green; 944/944 server tests green.
- User-visible cadence: ~6 micro-flickers per minute during active Claude streaming (atlas rebuild flash on each maintenance pass), zero flicker when idle, additional fire-on-wheel when the user scrolls during streaming.
- Smearing / ghosting / cursor-stale reduced from "visibly persistent until manual remount" to "max 10 s window during streaming, immediately resolved on scroll".

## Rejected Alternatives

1. **Wait for xterm 7.0** — open issue with no announced release date; user-visible regression cannot be blocked on upstream cadence.
2. **Use `term.onScroll` exclusively for user-wheel detection.** Rejected: documented to fire only for content-driven scroll. Tabby dropped this approach for the same reason.
3. **Patch xterm.js fork to clear atlas on every write-batch.** Rejected: forking the renderer breaks the npm-pinned matched-set contract from ADR-097 and would need re-validation on every upstream release.
4. **Listen to `keydown` for PgUp/PgDn/Shift+Home in v8.** Lower priority; open for a follow-up if accessibility feedback surfaces it.
5. **Drive atlas-maintenance from a single high-frequency `requestAnimationFrame` polling loop.** Would re-introduce the v1–v2 idle-flicker problem.

## Falsifiability

ADR-099 was falsified if (a) xterm.js 7.0 shipped with `#5847` fixed AND `@xterm/addon-serialize` 0.15+ shipped with mouse-encoding round-trip support, AND (b) a real-Claude UAT with all atlas-maintenance triggers DISABLED showed zero smearing over a 30 min Claude session AND wheel-after-detach correctly forwarded to Claude. The empirical bisect by ADR-108 found a different root cause (replay/live interleave) and falsified the workaround necessity directly.

## External Plan Review / Code Review Cascade / Confidence Calibration / F0.5

Iterate K was the user-driven UAT-loop branch (`codex-rescue-altscreen-rendering`); the Shipwright iterate-orchestrator phase gates were not entered. Empirical anchor is the systematic Playwright probe documented above. User UAT post-merge confirmed visual cadence.

## Post-v8 Empirical-validation Attempt (2026-05-14)

After v8 (`f07a66d`), a second empirical validation pass targeted the visual outcome specifically. Two probe scripts:

1. `client/e2e/probe-iterate-k-smearing-ab.mjs` — synthetic Claude-shaped stress (256-color glyphs + cursor-rights, written via `term.write()` directly), screenshots of matched OFF/ON pairs. Required adding a probe-only query-param kill switch `?atlasMaintenance=off`.
2. `client/e2e/probe-iterate-k-smearing-video.mjs` — real-pty A/B: fresh task per trial, pwsh `[Console]::Write` 256-color colorblast typed into the embedded terminal pane (real WS → real pty → real xterm WebGL renderer), `recordVideo` enabled, 40 s sustained streaming.

**Validated** ✓ kill-switch gating, workaround affects WebGL pixel output, v8 wheel listener fires through mouse capture, alt-screen invariant `altClears == 0` across 17 176 events, documented mid-clear flash is real.

**NOT validated** ✗ visible smearing reduction in stills OR video — synthetic pwsh stream does not reproduce the Claude-TUI-specific cell-update churn that produces user-reported "Verschmierungen".

**Honest interpretation:** the bug likely requires real Claude's specific cell-update churn pattern (color → text overwrite → cursor-jump → re-color → cursor-jump-back, at the rate Claude's renderer emits frames) to manifest. Naive per-cell color emit + cursor-right — though it matches the trigger-shape description — does not reproduce the visible bug.

**Decision (at the time):** ship v8 with the kill switch + both probe scripts committed as **regression infrastructure** rather than positive empirical proof. The v1–v7 commit history on this branch with its embedded user-UAT-driven iteration IS the load-bearing visual validation for the workaround as a whole.

**Subsequent finding (ADR-108):** the renderer-bisect probe (iterate-20260516-terminal-smear-interleave) proved both WebGL AND DOM renderers smeared, falsifying the atlas-corruption hypothesis. Real root cause was a client-side replay/live-data interleave; the entire workaround was removed.

## Files modified

`client/src/components/terminal/EmbeddedTerminal.tsx`, `client/e2e/probe-iterate-k-scenarios.mjs` (NEW), `client/e2e/probe-resume-flow.mjs` (NEW), `.shipwright/agent_docs/decision_log.md` (this ADR-099 entry), `CHANGELOG.md` (1 Fixed bullet — Iterate K consolidated).
