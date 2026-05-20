# Handoff: Iterate K v8 + Systematic Playwright Testing (fresh session)

**Branch:** `iterate/codex-rescue-altscreen-rendering` (pushed to origin)
**Last commit:** `e01bae9` fix(terminal): post-mount maintenance for Resume-after-reload (ADR-099 v7)
**Dev stack state:** Hono `:3847` + Vite `:5173` running on Tailscale (`100.64.0.1` / `webui-host.tailnet.ts.net`)

## Sitrep — was bisher gemacht wurde

### Commits auf `iterate/codex-rescue-altscreen-rendering` (in chronologischer Reihenfolge)

| # | Commit | Was |
|---|---|---|
| 1 | `cd6b9f7` | WebGL `loadAddon` VOR `term.open()` + `rescaleOverlappingGlyphs: true` — **bereits in main via PR #12** |
| 2 | `814620c` | Server-side: re-emit `?1006h` SGR mouse encoding in snapshot envelope (fix für scroll-after-detach) |
| 3 | `bd9e3ea` | atlas-clear v1: periodic 30s + onScroll `clearTextureAtlas()` |
| 4 | `4e8f938` | v2: interval 30s → 10s + `term.refresh()` nach clear |
| 5 | `f0ce31a` | v3: conditional via `onWriteParsed` counter (skip wenn idle) |
| 6 | `bf7b05f` | v4: skip atlas-clear in alt-screen (avoids Claude-superimpose-flicker) |
| 7 | `e9aa804` | v5: split — main-buffer = full clear+refresh, alt-screen = refresh only |
| 8 | `104435b` | v6: burst-after-quiet trigger (`onWriteParsed` + 2s gap → immediate maintenance) |
| 9 | `05724ca` | Vite WS proxy hardening: swallow ECONNRESET/ECONNABORTED/EPIPE |
| 10 | `84c014c` | cherry-pick: D-e2e task-type matrix spec |
| 11 | `e01bae9` | v7: pre-init lastWriteTime + post-mount settle timer (3s backstop) |

Plus `b0e2aa4` direkt auf main (dynamic-stack-profiles cherry-pick).

### Tests-Stand

- Client: 40/40 terminal tests grün, tsc clean
- Server: 936/936 grün
- Playwright probe scripts vorhanden in `client/e2e/probe-terminal-smearing*.mjs` und `client/e2e/probe-resume-flow.mjs`

### User-UAT-Verlauf (kurz)

1. v1 → v4: smearing primary fix lief; alt-screen heavy flicker durch superimponiertes clear
2. v5 (alt-screen-skip): stale cursor blieb in alt-screen → added refresh-only path
3. v6 (burst-trigger): "Resume nicht greift" wenn snapshot replay bundled mit burst
4. v7 (post-mount settle + lastWriteTime pre-init): Resume nach reload getestet
5. **Aktuelle offene Lücke**: scroll-while-streaming → mein onScroll feuert nicht weil Claude mouse-capture an

---

## v8 zu implementieren — DOM wheel listener (Tabby-Pattern)

**Direkte Quote aus Tabby (`tabby-terminal/src/frontends/xtermFrontend.ts`):**

> "NOTE: xterm.onScroll only fires for content-driven scroll (new lines), NOT for user wheel/keyboard scroll (xterm.js #3864, #3201). During fast output, viewportY transiently equals baseY during xterm's internal processing, so onScroll would falsely re-pin. We do NOT use onScroll for pin state. Re-pinning happens only via:
>   - wheel/keyboard event listeners (below)
>   - explicit scrollToBottom() calls"

**Implementation:** Attach DOM `wheel` listener on the terminal container element, debounced. Each wheel event → schedule `safeAtlasMaintenance()` after ~150ms quiet.

### Code-Skizze (v8)

In `client/src/components/terminal/EmbeddedTerminal.tsx`, nach dem `if (webglRef) { ... }` block, IM `term.open(container)` Bereich:

```ts
// Iterate K v8 (ADR-099) — DOM wheel listener for user-initiated scroll
// during streaming. xterm's onScroll only fires for content-driven scroll,
// NOT for user wheel/keyboard input — verified in xterm.js issue #3864 +
// Tabby's xtermFrontend.ts (which dropped onScroll for the same reason).
//
// Also: when Claude TUI has mouse capture (?1000h/1006h) on, wheel events
// go to Claude not to xterm's scroll. The DOM listener fires on the
// container before/regardless of capture forwarding, so we always see
// the user-intended-scroll signal.
let wheelDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const WHEEL_DEBOUNCE_MS = 150;
const onWheel = () => {
  if (wheelDebounceTimer) clearTimeout(wheelDebounceTimer);
  wheelDebounceTimer = setTimeout(() => {
    wheelDebounceTimer = null;
    if (webglRef && !disposedRef.current) safeAtlasMaintenance();
  }, WHEEL_DEBOUNCE_MS);
};
container.addEventListener("wheel", onWheel, { passive: true });
```

Cleanup section:

```ts
container.removeEventListener("wheel", onWheel);
if (wheelDebounceTimer) {
  clearTimeout(wheelDebounceTimer);
  wheelDebounceTimer = null;
}
```

---

## Systematic Playwright headed test plan

Each scenario should be a separate `test()` in a new spec
`client/e2e/probe-iterate-k-scenarios.mjs` (or as a real Playwright test
in `client/e2e/flows/iterate-k-atlas-maintenance.spec.ts`).

### Scenarios to verify

| # | Scenario | Expected v8 behavior | How to test |
|---|---|---|---|
| S1 | Fresh mount + Resume immediately | First burst triggers maintenance | Click Resume, watch console for maintenance fire timing |
| S2 | Fresh mount + Resume after long delay | Burst trigger fires after >2s gap | Wait 3s then click Resume |
| S3 | Active streaming + scroll wheel | DOM wheel listener triggers maintenance debounced | During Claude streaming, dispatchEvent wheel → maintenance fires within 150ms |
| S4 | Active streaming + 2s pause + new burst | Burst-after-quiet trigger fires | Pause Claude 2s+ then send Enter → maintenance fires on first burst |
| S5 | Tab switch out/in (visibility change) | Atlas may need rebuild on return | toggle tab → maintenance fires |
| S6 | Long-idle session (no writes, just reading) | Zero flicker, no maintenance fires | Wait 30s on idle terminal, count maintenances = 0 |
| S7 | Alt-screen mode (Task 58be94c5) | Only `term.refresh()`, no `clearTextureAtlas()` | Spy on `webgl.clearTextureAtlas` calls = 0 in alt-screen |
| S8 | Main-buffer mode + active streaming | Full clear+refresh every 10s | Spy = 6× over 60s of active streaming |
| S9 | Mouse capture on + wheel scroll | DOM wheel fires (Claude gets event but WE also see it) | Verify our handler fires even when Claude receives the wheel report |
| S10 | xterm 7.0 sim — confirm we still benefit | (Future) when upstream fixes #5847, our workaround stays harmless | Confirm clearTextureAtlas() on a healthy atlas is a no-op visually |

### How to instrument

For each scenario:
1. Spy on `WebglAddon.clearTextureAtlas` and `Terminal.refresh` via Playwright `page.evaluate` (patch the prototype with a counter before mount).
2. Capture timing of each call.
3. Assert against expected.

Bonus: capture screenshots before/after maintenance to verify visual cleanup.

### Reference Tabby quote for `xterm.js#3864` + `#3201`

Both issues are old (2021) and about onScroll firing semantics. They explain why user-wheel doesn't fire onScroll. Keep in commit message + ADR.

---

## ADR-099 sketch (for final documentation)

Title: **xterm.js 6.0.0 WebGL atlas-corruption workaround + addon-serialize SGR-encoding fix**

Status: ACCEPTED (after v8 + Playwright validation)

Context:
- xterm.js 6.0.0 has unresolved bug #5847 (atlas-merge corruption under sustained streaming)
- `@xterm/addon-serialize` 0.19.0 doesn't serialize mouseEncoding modes (?1006h SGR)
- Claude Code TUI is our primary workload, triggers both bugs

Decision:
1. Server-side: re-emit `?1006h` in snapshot envelope when mouse tracking detected (`replay-snapshot.ts buildReplaySnapshotEnvelope`)
2. Client-side: periodic + conditional + event-triggered `clearTextureAtlas()` + `term.refresh()` workaround:
   - 10s periodic, gated by `onWriteParsed` counter
   - Immediate on burst-after-2s-quiet
   - Immediate on `term.onScroll` (content-driven scroll only)
   - Immediate on DOM `wheel` event (debounced 150ms — user-initiated scroll)
   - Post-mount 3s settle backstop
   - Buffer-type aware: main-buffer = clear+refresh, alt-screen = refresh-only

Consequences:
- ~6 micro-flickers/min during active Claude streaming (atlas rebuild)
- Zero flicker when idle
- Smearing/ghosting reduced from "visibly persistent" to "max 10s window"
- Upstream xterm 7.0 will obsolete this workaround — code remains harmless

Cross-references:
- `xtermjs/xterm.js#5847` (atlas merge bug, milestone 7.0)
- `xtermjs/xterm.js#5100` (rescaleOverlappingGlyphs)
- `xtermjs/xterm.js#5620` (Claude/AI-CLI scrollbar shake)
- `xtermjs/xterm.js#3864` + `#3201` (onScroll semantics — content vs user)
- `microsoft/vscode xtermTerminal.ts:600` forceRedraw pattern
- `Eugeny/tabby tabby-terminal/src/frontends/xtermFrontend.ts` DOM wheel listener pattern
- `siteboon/claudecodeui useShellTerminal.ts` siteboon reference
- `xtermjs/xterm.js demo/client/client.ts` canonical addon-load-order

---

## Fresh session prompt (suggested)

```
Branch: iterate/codex-rescue-altscreen-rendering

Tasks:
1. Implement v8 from .shipwright/planning/iterate/handoff-v8-systematic-testing.md
   — DOM wheel listener with 150ms debounce (Tabby pattern from xterm.js#3864/3201).
2. Build Playwright headed test spec covering all 10 scenarios in the handoff.
3. Iterate based on empirical results.
4. Finalize ADR-099 in agent_docs/decision_log.md.
5. Open PR for merge to main.

Don't re-research — handoff doc has all reference patterns + quotes.
Dev stack: Hono :3847 + Vite :5173 already running on Tailscale.
Active live tasks: 4a9fe7f2 (main-buffer), 58be94c5 (alt-screen), 810efeca (main-buffer + recent).
```

---

## Open questions for new session

1. v8 wheel listener: capture phase or bubble phase? Tabby uses bubble (no `{capture: true}`). Recommend bubble — fires AFTER xterm internal but still before render frame. Our handler is fire-and-forget anyway.

2. Should we also add a keyboard listener for PgUp/PgDn/Shift+Home? Tabby does. Lower priority since most users scroll with wheel, but matters for accessibility.

3. v8 brings flicker frequency higher: any wheel = ~150ms later flicker. Combined with 10s periodic + burst-trigger, might be visible. Trade-off: scroll smearing pays back.

4. After v8 + Playwright validation: ready to merge to main? Or wait for xterm 7.0?

---

## State at handoff

```
Branch: iterate/codex-rescue-altscreen-rendering @ e01bae9
- pushed to origin
- 9 user-facing commits + 1 cherry-pick + 1 vite-proxy fix
- tests: 40/40 client terminal + 936/936 server
- typecheck: clean

Dev stack:
- Hono :3847 PID ~12432
- Vite :5173 PID ~25520
- both with iterate K v1-v7 + v6-mouse-encoding-fix active

Untouched in cleanup:
- Branch `iterate/xterm-6-upgrade` + `.worktrees/xterm-6-upgrade` (pwsh.exe PID 26004 lock)
- `.git/worktrees/security-workflows-drop` admin entry (permission denied)
```
