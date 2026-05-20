# Iterate K — xterm.js 6.0 WebGL atlas-corruption workaround + SGR-encoding fix

- **Run ID:** iterate-2026-05-14-K-atlas-corruption-workaround
- **Branch:** `iterate/codex-rescue-altscreen-rendering` (merged into main as merge commit `3b8bc0d`, PR #14)
- **ADR:** [ADR-099](../../agent_docs/decision_log.md#adr-099)
- **Status:** RECONSTRUCTED POST-HOC (2026-05-15). The iterate was driven by user UAT and shipped commit-by-commit without a prospective spec. This document captures intent + decisions retroactively for audit/compliance traceability.

## Problem

Two upstream bugs in the xterm.js 6.0.0 stack manifest on every sustained Claude Code TUI session in the embedded-terminal pane:

1. **`xtermjs/xterm.js#5847`** — WebGL texture-atlas merge corruption (open, milestone 7.0). The atlas accumulates duplicate cache entries and coordinate drift during sustained per-cell color-attribute streaming (Claude TUI's emit shape: `\x1b[38;5;Nm` runs separated by `\x1b[1C` cursor-rights at per-word granularity). Symptom: visible smearing / ghosting / glyph substitution on rows with ANSI color, recovered ONLY by atlas-clear, resize, or remount.

2. **`@xterm/addon-serialize` 0.14.0** — does NOT serialize mouse-encoding mode (`?1006h` / `?1000h` / `?1002h`). After re-attach the `replay_snapshot` envelope replays cell-state correctly but mouse-wheel events go to xterm's native scroll-viewport instead of being forwarded to Claude as mouse-reports — the user's wheel scrolls a frozen historical buffer instead of driving Claude's UI.

Both surface as the same user-visible symptom class: "Verschmierungen / smearing / stale-cursor-ghosting after Resume / mouse-wheel after detach goes to the wrong place".

## Approach

**Buffer-type-aware, activity-gated, multi-trigger atlas-maintenance pass** in `EmbeddedTerminal.tsx`:

- Main buffer → `webglRef.clearTextureAtlas()` + `term.refresh(0, rows-1)` (full xterm.js#5847 workaround)
- Alt-screen → `term.refresh(0, rows-1)` only (alt-screen redraws every frame, full clear superimposed on Claude's repaint produced visibly worse flicker; v3 UAT)

Triggers (final post-v10 stack):
1. **10 s periodic** gated by `writesSinceLastClear > 0` — zero flicker when idle
2. **`term.onScroll`** — content-driven scroll (new lines pushing viewport)
3. **`term.onWriteParsed` burst-after-2-s-quiet** — catches Resume / re-attach / wake-up
4. **Post-mount-settle backstop at +3 s** — fresh-mount + bundled-burst case
5. **DOM `wheel` listener with 150 ms debounce** — user-initiated scroll during mouse-capture (Tabby pattern, xterm.js#3864 / #3201)
6. **Post-launch-settle at +4 s** after every `coord.consumeLaunch` — Resume-click-in-long-mounted-tab (auto-launch typing echo defeats burst-trigger)
7. **Post-replay-snapshot via `setTimeout(0)`** — large-snapshot writes accumulate corruption past the burst-trigger's first fire (re-mount-after-navigate-back case)

**Server-side**: `server/src/terminal/replay-snapshot.ts buildReplaySnapshotEnvelope` re-emits `\x1b[?1006h` (+ `?1000h` / `?1002h` when active) at the end of the serialized payload (Iterate K commit `814620c`).

## Files modified (per-commit history)

Eleven user-facing commits (chronological, all on the merged branch):

| # | Commit | Files | Purpose |
|---|---|---|---|
| 0 | `814620c` | `server/src/terminal/replay-snapshot.ts` | Server re-emits `?1006h` SGR mouse encoding |
| 1 | `bd9e3ea` | `EmbeddedTerminal.tsx` | v1: 30 s periodic + `onScroll` |
| 2 | `4e8f938` | `EmbeddedTerminal.tsx` | v2: 10 s periodic + `term.refresh()` after clear |
| 3 | `f0ce31a` | `EmbeddedTerminal.tsx` | v3: conditional via `onWriteParsed` counter (skip when idle) |
| 4 | `bf7b05f` | `EmbeddedTerminal.tsx` | v4: skip atlas-clear in alt-screen |
| 5 | `e9aa804` | `EmbeddedTerminal.tsx` | v5: split — main=clear+refresh, alt=refresh-only |
| 6 | `104435b` | `EmbeddedTerminal.tsx` | v6: burst-after-2-s-quiet trigger |
| 7 | `05724ca` | `client/vite.config.ts` (proxy) | Vite WS proxy swallows ECONNRESET/ECONNABORTED/EPIPE |
| 8 | `84c014c` | `client/e2e/flows/v0-9-5-task-type-matrix.spec.ts` | D-e2e task-type matrix cherry-pick |
| 9 | `e01bae9` | `EmbeddedTerminal.tsx` | v7: pre-init `lastWriteTime` + post-mount-settle backstop |
| 10 | `f07a66d` | `EmbeddedTerminal.tsx`, `e2e/probe-iterate-k-scenarios.mjs`, `e2e/probe-resume-flow.mjs` | v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic probe |
| 11 | `d67ada6` | `EmbeddedTerminal.tsx`, `e2e/probe-iterate-k-smearing-{ab,video}.mjs` | Kill switch `?atlasMaintenance=off` + A/B probes (stills + video) as regression infra |
| 12 | `44102aa` | `EmbeddedTerminal.tsx` | v9: post-launch-settle (4 s after `coord.consumeLaunch`) |

Post-merge v10 (`28daae1`, PR #16):
- `EmbeddedTerminal.tsx` onReplaySnapshot setTimeout(0) maintenance — fixes re-mount-after-navigate-back smearing UAT 2026-05-14.

## Empirical evidence

User-UAT-driven iteration. Per-commit messages capture the empirical findings:

- v3 → "smearing primary fix lief; alt-screen heavy flicker durch superimponiertes clear"
- v5 → "stale cursor blieb in alt-screen → added refresh-only path"
- v6 → "Resume nicht greift wenn snapshot replay bundled mit burst"
- v7 → "Resume nach reload getestet"
- v8 → 10-scenario Playwright probe with WebGL spies, alt-screen invariant `altClears == 0` validated across 17 176 events
- v9 → "es hat resume nicht gegriffen, erst nach 10s gut" — auto-launch typing-echo diagnosis
- v10 → "Extremes flickern und auch starkes verschmieren links" on re-mount-after-navigate-back

## Trade-offs accepted

- ~6 micro-flickers/minute during active Claude streaming (atlas rebuild flash on each maintenance pass)
- Zero flicker when idle
- Smearing reduced from "visibly persistent until manual remount" to "max 10 s window during streaming, immediately resolved on scroll/resume"
- Synthetic-stress reproduction failed (probe-iterate-k-smearing-video.mjs with pwsh `[Console]::Write` 256-color colorblast) — the bug requires real Claude's specific cell-update churn pattern that naive per-cell color emit doesn't replicate; visual validation rests on the chronological user-UAT history

## Falsifiability

If xterm.js 7.0 ships with `#5847` fixed AND `@xterm/addon-serialize` 0.15+ ships with mouse-encoding round-trip support, AND a real-Claude UAT with all atlas-maintenance triggers DISABLED (via `?atlasMaintenance=off` kill switch) shows zero smearing over a 30-min Claude session AND wheel-after-detach correctly forwards to Claude, then ADR-099 should be deleted, the test-handle exports rolled back, and the workaround marked Superseded.

## Cross-references

- `xtermjs/xterm.js#5847` (WebGL atlas merge corruption, milestone 7.0)
- `xtermjs/xterm.js#3864` + `#3201` (`onScroll` content-driven semantics)
- `xtermjs/xterm.js#5100` (`rescaleOverlappingGlyphs`, pre-merged via PR #12)
- `xtermjs/xterm.js#5620` (Claude / AI-CLI scrollbar shake)
- `microsoft/vscode src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts:600` (`forceRedraw` pattern)
- `Eugeny/tabby tabby-terminal/src/frontends/xtermFrontend.ts` (DOM wheel listener pattern)
- `siteboon/claudecodeui src/components/shell/hooks/useShellTerminal.ts:87-104` (canonical addon load order)

## Build / Verification

- Client typecheck clean, server typecheck clean
- 40/40 EmbeddedTerminal unit tests green throughout iterate
- 944/944 server vitest green at merge (PR #14)
- Playwright scenarios probe captured 17 176 maintenance events with `altClears == 0` invariant holding
- Kill switch + A/B probes shipped as permanent regression infrastructure
