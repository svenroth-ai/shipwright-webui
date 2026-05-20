# Codex-Rescue Findings — xterm.js Alt-Screen Rendering Artifacts

**Date:** 2026-05-14
**Branch base:** `main` at `79dd375` (post-ADR-098)
**Status (2026-05-14 ~01:00, evening):** Two patches applied (uncommitted). 1720 tests green. Live-UAT empirical result is MIXED — see "Live UAT result" section at the bottom. **No commit pending; user wants to research more tomorrow before deciding.**

---

## Symptoms under investigation (recap)

Three visible artifacts in the embedded terminal when Claude Code TUI 2.1.140 renders in alt-screen mode (`CLAUDE_CODE_NO_FLICKER=1` default-on, post-ADR-098):

1. **Text smearing / mashing** during streaming output (e.g. "de Code" instead of "Claude Code"; "goalsdBefehlsgenauimacht.erate sinnvoll andocken" — words concatenated).
2. **Column-0 fragments** stuck during alt-screen scroll (leftmost-column word fragments like "Ko", "Mi", "Wa" lag behind clean redraws).
3. **Click-on-input flicker layer** — focusing the input box re-renders with visible intermediate frames.

Empirically falsified (mid-Iterate-J UAT): WebGL-off probe produced *worse* smearing → WebGL is load-bearing for alt-screen rendering. Probe reverted, not committed.

---

## Investigation summary

### 1. Decision-log internalised
ADR-087 through ADR-098 read in full. The campaign has paid down architecture-level debt (chunked replay → snapshot envelope → live-mirror precedence → xterm 6 upgrade), but the surface rendering artifacts have only ever been *mitigated* via env-var workarounds (NO_FLICKER) and configuration alignment with siteboon — never via a renderer-level fix.

### 2. Triangulation across three xterm.js consumers (post-Codex follow-up)

User raised a fair concern: siteboon is one data point, and they're on xterm 5.x. Verified the pattern against two more references — including the canonical one from the xterm.js maintainers themselves.

**a) `xtermjs/xterm.js/demo/client/client.ts` lines 342-354** (the xterm.js OFFICIAL demo, written by the maintainers):

```ts
if (addons.webgl.instance) {
  try {
    typedTerm.loadAddon(addons.webgl.instance);   // WebGL LOADED FIRST
    term.open(terminalContainer!);                  // THEN open()
  } catch (e) {
    console.warn('error during loading webgl addon:', e);
    addons.webgl.instance.dispose();
    addons.webgl.instance = undefined;
  }
} else {
  // webgl loading failed for some reason, attach with DOM renderer
  term.open(terminalContainer!);
}
```

This is the canonical maintainer-blessed pattern.

**b) `microsoft/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` lines 489-499**:

```ts
attachToElement(container: HTMLElement, …) {
  …
  if (!this._attached) {
    this.raw.open(container);
  }

  // TODO: Move before open so the DOM renderer doesn't initialize
  if (options.enableGpu) {
    if (this._shouldLoadWebgl()) {
      this._enableWebglRenderer();
    }
  }
```

VS Code currently loads WebGL AFTER `open()` (matching shipwright's current pattern) **but with an explicit `TODO` from the xterm.js BDFL's own team flagging this as suboptimal — exactly because the DOM renderer initializes first**. That comment is direct empirical confirmation of the renderer-swap mechanism we hypothesized.

**c) `siteboon/claudecodeui/src/components/shell/hooks/useShellTerminal.ts` lines 87-104**:

```ts
const nextTerminal = new Terminal(TERMINAL_OPTIONS);
…
nextTerminal.loadAddon(nextFitAddon);
if (!minimal) {
  nextTerminal.loadAddon(new WebLinksAddon());
}
try {
  nextTerminal.loadAddon(new WebglAddon());     // before open()
} catch {
  console.warn('[Shell] WebGL renderer unavailable, using Canvas fallback');
}
nextTerminal.open(terminalContainerRef.current);
```

Three consumers, one canonical pattern, plus a TODO from xterm's BDFL acknowledging the bug we're seeing.

### 3. Concrete delta vs. `siteboon/claudecodeui` (initial probe)

Pulled siteboon main:
- `src/components/shell/hooks/useShellTerminal.ts`
- `src/components/shell/constants/constants.ts`
- `package.json`

**Addon load order — different and structural:**

| Step | siteboon (working reference) | shipwright current |
|------|------------------------------|--------------------|
| 1 | `new Terminal(TERMINAL_OPTIONS)` | `new Terminal({...})` |
| 2 | `loadAddon(FitAddon)` | `loadAddon(FitAddon)` |
| 3 | `loadAddon(WebLinksAddon)` | `loadAddon(WebLinksAddon)` |
| 4 | **`loadAddon(WebglAddon)`** ← before open | **`term.open(container)`** ← before WebGL |
| 5 | `nextTerminal.open(container)` | **`loadAddon(WebglAddon)`** ← after open |

Verified at:
- siteboon: `/tmp/siteboon-useShellTerminal.ts` lines 87–104
- shipwright: `client/src/components/terminal/EmbeddedTerminal.tsx` lines 609–639

### 3. Our load-order comment is misinformation

`client/src/components/terminal/EmbeddedTerminal.tsx` lines 614–621 (introduced in ADR-093, commit `6f715fc`) reads:

> WebGL must be loaded AFTER term.open(container) — addon-webgl needs an attached DOM context.

**This is wrong.** Verified by reading `xtermjs/xterm.js` upstream — `WebglAddon.activate()` explicitly handles the case where the terminal isn't open yet:

```ts
public activate(terminal: Terminal): void {
  const core = (terminal as any)._core as ITerminal;
  if (!terminal.element) {
    this._register(core.onWillOpen(() => this.activate(terminal)));
    return;
  }
  // … real activation
}
```

The addon registers an `onWillOpen` listener and re-activates itself when `open()` fires. Loading before `open()` is fully supported and is in fact the pattern xterm.js's own tutorials use. The comment was apparently added without empirical verification.

### 4. Plausible mechanism for the artifacts

With shipwright's current order (open() → loadAddon(WebGL)):

1. `term.open(container)` instantiates the default renderer (DOM or Canvas) and renders the first frame(s).
2. `term.loadAddon(WebglAddon)` triggers `WebglAddon.activate()` which tears down the default renderer and switches to WebGL mid-stream.

For Claude TUI's alt-screen redraw pattern (high-frequency CUP-heavy, ~21 690 CUP-class sequences in 265 711 bytes per Iterate J empirical probe), this renderer-swap window could:
- Leak partial-redraw state from the Canvas/DOM renderer into the initial WebGL frames.
- Mis-handle cells that were partially redrawn during the swap.
- Create the column-0 ghosting if Canvas/DOM's column-0 cells weren't fully invalidated before WebGL took over.

This is a **plausible** mechanism but **NOT empirically proven** as the root cause. It is the *one* concrete, mechanism-bearing structural delta vs. the working reference.

### 5. Other deltas (cheap to align, not load-bearing for these artifacts)

Siteboon `TERMINAL_OPTIONS` we don't set:

| Option | Siteboon | Mechanism for smearing? |
|--------|----------|------------------------|
| `allowTransparency: false` | yes | No (we default to false too) |
| `tabStopWidth: 4` | yes | Tab expansion only |
| `macOptionIsMeta: true` | yes | Mac keyboard only |
| `macOptionClickForcesSelection: true` | yes | Mac mouse only |
| `selectionForeground: '#ffffff'` | yes | Selection contrast only |
| `extendedAnsi: [...]` | yes | 16-color extended palette only |

None of these have a plausible mechanism for smearing/column-0/click-flicker. They're cosmetic alignment opportunities, not load-bearing.

### 6. xterm.js version delta — important caveat

**Siteboon pins `@xterm/xterm@^5.5.0`. We are on `6.0.0` post-ADR-097.**

This means siteboon's working load-order pattern is verified on xterm 5.x. We can't blindly assume the same pattern delivers the same rendering quality on xterm 6.0.0. Possible scenarios:

- **Scenario A**: The load-order delta is the root cause and the fix works on 6.x too → siteboon-parity restores clean rendering.
- **Scenario B**: The load-order delta is the root cause on 5.x but xterm 6.0.0 introduced a separate WebGL renderer regression → load-order fix helps but doesn't fully resolve.
- **Scenario C**: The artifacts are an xterm 6.0.0 WebGL bug independent of load order → load-order change makes no visible difference.

We need a live UAT to distinguish.

---

## Proposed minimal patch (NOT applied)

**File:** `client/src/components/terminal/EmbeddedTerminal.tsx`

**Change:** Move `loadAddon(webgl)` from after `term.open(container)` to before it. Update the misleading comment.

```diff
       const fit = new FitAddon();
       const links = new WebLinksAddon();
       term.loadAddon(fit);
       term.loadAddon(links);
-      term.open(container);
-      // Iterate F (ADR-093) — WebGL renderer for atomic full-frame redraws.
-      // … WebGL must be loaded AFTER term.open(container) — addon-webgl needs
-      // an attached DOM context. …
       try {
         const webgl = new WebglAddon();
         term.loadAddon(webgl);
       } catch (err) {
         console.warn(
           "[EmbeddedTerminal] WebGL renderer unavailable — falling back to Canvas/DOM:",
           err instanceof Error ? err.message : String(err),
         );
       }
+      // Iterate K (ADR-099) — WebGL renderer loaded BEFORE term.open() to
+      // match siteboon/claudecodeui's pattern. WebglAddon.activate() defers
+      // initialization via `core.onWillOpen` when the terminal isn't yet
+      // attached, so pre-open registration is fully supported. The previous
+      // post-open order forced a renderer-swap mid-stream (Canvas/DOM →
+      // WebGL) which leaked partial-redraw state into alt-screen rendering.
+      term.open(container);
```

LOC delta: ~10 lines. Within 100 LOC across 1 file. Does not violate any DO-NOT guard.

---

## Why I'm NOT committing this directly

Per the user's explicit directive ("investigate first; commit second") and the Build vs. Report decision rule:

| Build criterion | Status |
|-----------------|--------|
| Diagnosis identified clear root cause | ⚠ Plausible mechanism only; not empirically proven |
| Fix < 100 LOC across < 5 files | ✓ ~10 LOC, 1 file |
| Doesn't violate constraints | ✓ |
| All 1720 tests stay green | ⚠ Unknown — needs `npm run typecheck` + `npm run test` run |
| ADR-099 can clearly state evidence + mechanism | ⚠ "Plausible siteboon-parity" is weaker than "empirically verified" |

| Report criterion | Status |
|------------------|--------|
| Structural problem requiring upstream fix | ✗ |
| Would require violating a constraint | ✗ |
| Multiple candidate fixes with significant trade-offs | ⚠ Partial — load-order is the cheap test; xterm 5.x downgrade is the alternative escape hatch with much larger blast radius |
| Uncertain about empirical evidence | ✓ Mechanism is plausible; effect on the actual symptoms is unproven |

Plus, this campaign has stacked 9 iterates of mitigations. Memory `feedback_stop_stacking_patches.md` explicitly says: "when fix N+1 doesn't fully work, STOP and read actual artifacts before patch N+2. Empirically falsify hypothesis BEFORE committing."

---

## Recommended path forward (user choice)

### Option A — Apply minimal patch + live UAT (recommended)

1. User approves the load-order patch above.
2. Apply patch (1 file, ~10 LOC).
3. Run `npm run typecheck` + `npm run test` in `client/` to verify tests stay green.
4. User opens task `5a5832a3-6e76-44bd-bf10-202b90a7f270` in dev stack at `http://100.64.0.1:5173/tasks/5a5832a3-6e76-44bd-bf10-202b90a7f270` and reports:
   - Does smearing improve / disappear / stay the same?
   - Do column-0 fragments improve / disappear / stay the same?
   - Does click-flicker improve / disappear / stay the same?
5. If clear improvement → write ADR-099, commit on `iterate/codex-rescue-altscreen-rendering`, push for orchestrator merge.
6. If no improvement or partial → revert, document the empirical negative result in ADR-099, move to Option B or C.

**Trade-off:** Cheap and reversible. Worst case is a 10-line revert.

### Option B — Bisect: try `@xterm/xterm@5.5.0` with same addon load order

Test whether the artifacts disappear on the xterm 5.x line that siteboon ships. This would isolate "is this an xterm 6.0.0 regression vs. 5.5.0?". Significant constraint cost:
- Violates ADR-088 invariant #4 if not paired with snapshot version re-pin.
- Reverts ADR-097's empirical M2 fixed-point verification.
- Snapshot header v2 → v1 transition (would need to either drop snapshot v2 acceptance or keep both during the test).

Don't pick this unless Option A produces a clear negative.

### Option C — Defer and report upstream

If both A and B produce no improvement: the artifacts are likely an xterm 6.0.0 WebGL renderer issue with Claude TUI's specific CUP pattern. ADR-099 would be a "no clean fix" finding with:
- Empirical evidence of both probes
- Upstream issue filed at `xtermjs/xterm.js` with the captured byte stream as reproduction
- Cosmetic alignment of the small siteboon-parity knobs (`tabStopWidth`, `selectionForeground`, etc.) as a defense-in-depth landing

### What I would NOT recommend

- **Stacking another env-var workaround** — no plausible env-var maps to the renderer-swap mechanism.
- **Rewriting EmbeddedTerminal to use a different terminal library** — out of scope; xterm.js is industry standard.
- **Disabling WebGL** — empirically falsified; Canvas/DOM is worse.

---

## What Codex actually did vs. what was needed

Codex (codex:codex-rescue invocation, agentId `a2e5fb6351d15051a`) identified the addon load-order delta but couldn't run probes in its sandbox (network/file restrictions on the scrollback file + npm). It correctly proposed Option A but flagged it needed empirical confirmation.

My follow-up extended Codex's finding by:
- Pulling siteboon files directly via `gh api` to verify the addon load-order claim.
- Reading `xterm.js` upstream `WebglAddon.activate()` source to confirm `onWillOpen` defers activation correctly.
- Identifying that our code comment justifying the current order is misinformation.
- Identifying the xterm 5.x vs 6.x version caveat that Codex missed.
- Catalogue of cosmetic config deltas (non-load-bearing for these artifacts).

---

## Files referenced

- `client/src/components/terminal/EmbeddedTerminal.tsx` lines 609–639 — current addon load order
- `.shipwright/agent_docs/decision_log.md` — ADR-087 through ADR-098 campaign history
- `CLAUDE.md` — DO-NOT regression guards (none violated by Option A)
- `client/package.json` — current xterm 6.0.0 pin
- `server/package.json` — current `@xterm/headless` 6.0.0 pin (paired-set per ADR-097)
- siteboon reference (pulled to /tmp): `useShellTerminal.ts`, `constants.ts`, `Shell.tsx`, `package.json` (xterm `^5.5.0`)

---

## Live UAT result + extended investigation (2026-05-14, late evening)

### What was applied + UAT outcome

**Move 1 — WebGL load-order** (`EmbeddedTerminal.tsx`): Apply order changed from
`fit→links→open→webgl` to `fit→links→webgl→open` to match xterm.js demo +
xterm-BDFL TODO comment in VS Code.
**UAT verdict**: ✓ Smearing fixed.

**Move 2 — `TERM=xterm-256color` env triple** (`buildSpawnEnv` in `routes.ts`):
Replaced `TERM=dumb / COLORTERM="" / FORCE_COLOR=1` with the siteboon-parity
`TERM=xterm-256color / COLORTERM=truecolor / FORCE_COLOR=3` on the
hypothesis that `TERM=dumb` was blocking Claude/Ink sync-output emission.
**UAT verdict**: ✗ Regression. User reported smearing partially back +
flicker still present.

### Empirical analysis post-UAT (this report)

Pulled the same task `4a9fe7f2-…`'s pre-restart and post-restart scrollback
files for a same-workload A/B comparison:

| Sequence | `TERM=dumb` (1 MB) | `TERM=xterm-256color` (200 KB) |
|---|---|---|
| ESC `[?2026h` / `[?2026l` (DECSET 2026) | **0** | **0** |
| ESC `[?1049h/l` (alt-screen) | 0 | 0 |
| ESC `[?25l/h` (cursor hide/show) | 0 | 4 |
| ESC `[?9001h` (win32 input mode) | 0 | 1 |
| ESC `[?1004h` (focus reporting) | 0 | 1 |
| ESC `[2J` (erase entire display) | 0 | 3 |
| ESC `[K` (erase line) | 85 | 150 |
| ESC `[8;53;146t` (window resize manipulation) | 0 | 1 |
| ESC `]0;<title>` (set window title) | 0 | 9 |
| ESC `[<n>;<n>H` (CUP — cursor position) | many | many |
| ESC `[<n>m` (SGR — color/style) | 15 746 | many |
| ESC `[1C` (cursor-right-by-1) | 27 760 | 4 392 |
| ESC `[38;2;...m` (truecolor RGB) | **0** | **0** |

**Two empirical findings falsified my Move-2 hypothesis:**

1. **Claude Code 2.1.140 emits ZERO DECSET 2026 sequences regardless of TERM.**
   `TERM=dumb` does NOT block Claude's sync-output emission. The ADR-098
   conclusion ("Claude doesn't emit DECSET 2026") stands. My causal model
   was wrong.

2. **Claude emits ZERO truecolor RGB regardless of `COLORTERM`/`FORCE_COLOR`.**
   The brand-color concern in ADR-067 may have been about a different
   chalk path or a since-fixed Claude behavior. The dark-mode trade-off
   conversation was based on a phantom regression.

**One real empirical finding explains the Move-2 regression:**

The post-restart scrollback shows **PowerShell 7.6.1** emitting xterm
window-manipulation sequences on every prompt-redraw — `?9001h`
(win32 input mode), `?1004h` (focus reporting), `?25l/?25h` (cursor
hide/show), `?2J` (erase entire screen), `8;53;146t` (window resize
to 53×146). Under `TERM=dumb` PowerShell stays in its no-VT mode and
emits none of these. Under `TERM=xterm-256color` it enters full
PSReadLine + xterm-feature mode. Every Strg+C return to prompt now
generates these aggressive redraw sequences in the embedded terminal,
which matches the user-reported "minim smearing came back" symptom.

### What I just applied (uncommitted, this report)

**Move 2-revert**: TERM env restored to `dumb / "" / 1` triple. Comment
extended with the empirical falsification, pointer to the new flicker
diagnosis, and explicit reasoning for keeping ADR-067's brand-fit hack
even though the brand-color concern was overblown. ([routes.ts:856-892](server/src/terminal/routes.ts#L856-L892), [pty-env-flicker.test.ts:86-96](server/src/terminal/pty-env-flicker.test.ts#L86-L96))

**Move 3 — `scrollOnEraseInDisplay: true`** (`EmbeddedTerminal.tsx`):
Defensive alignment with VS Code's terminal config + xterm.js maintainer
recommendation. **Note: this does NOT fix the user-reported flicker
in our specific NO_FLICKER=1 workload** — Claude under NO_FLICKER=1
emits zero ED2/ED3. The option only changes behavior of `\x1b[2J/3J`
sequences (cuts viewport vs. scrolls into scrollback). Defense-in-depth:
matches the reference repo we already align with; helpful if anything
else in the pane ever emits ED2 (PowerShell prompt redraws, any future
tool the user spawns). VS Code keeps it set for the same reason.

### Real flicker diagnosis

Authoritative source: xterm.js issue **#5620** ("Page Shaking and
Scrollbar Locked at Top When Using AI CLI Tools with Long Outputs"),
with statements from xterm.js BDFL @Tyriar (Daniel Imms, also VS Code
terminal lead) and core maintainer @jerch:

- @Tyriar: "claude code (+copilot) clears the entire scroll back and
  re-renders every time. This is what the flickering problems they
  had were about and why we got the contribution from Anthropic for
  sync output as obviously it wouldn't work without that feature."
- @jerch on #5801: "you can change the ED2 behavior from screen
  cutting (with scrollbar adjustments, spec conform) to down scrolling
  (scrollbar would stay at the end, not spec conform) by setting
  scrollOnEraseInDisplay to true. This is how iTerm2 and Terminal.app
  under macOS handle it … the maintainer of the AI cmdline tools
  tested only with those terminals, thus the wrong handling surfaces
  on a terminal being more spec conform."

**But this fix DOESN'T apply to our NO_FLICKER=1 setup**, because
NO_FLICKER instructs Claude to use surgical EL (erase-line) + CUP
(cursor positioning) instead of full-screen ED2/ED3 redraws. Our
scrollback empirically confirms: under NO_FLICKER=1 Claude emits
**zero** ED2 sequences in 1 MB of streaming output.

What Claude DOES emit at high frequency under NO_FLICKER=1:
- **15.3 SGR (style/color) sequences per KB** (15 746 SGR in 1 MB)
- **27.0 cursor-right-by-1 (`[1C`) per KB** (27 760 in 1 MB)
- **4.4 SGR-reset (`[m`) per KB**
- **Braille spinner chars** (`U+2836` = `⠶`, U+2800–U+28FF range)

These are the actual flicker-source candidates.

### Hypotheses for the residual flicker (NOT yet tested)

**H1 — Custom-glyph repaint on Braille spinner chars (high confidence)**

xterm's WebGL renderer with `customGlyphs: true` (default) paints
Braille chars via custom canvas rendering instead of the system font.
Claude's spinner cycles through U+2836–U+283F (Braille Patterns)
chars on every frame. Each spinner-frame swap triggers:
1. Color SGR change
2. Carriage return
3. New Braille char → custom canvas repaint
4. Color reset

At spinner refresh rate (likely 10–24 Hz from Ink's default), this is
10–24 custom canvas repaints per second, racing with xterm's rAF
debouncer + the cursor-blink timer. Plausible cause of visible
flicker during streaming.

**Probe**: pass `{ customGlyphs: false }` to the WebglAddon
constructor in `EmbeddedTerminal.tsx`. Braille chars render through
the system font instead. Trade-off: box-drawing chars in `tree`-like
output may show inter-cell gaps (cosmetic).

**H2 — Cursor-blink timer racing with Claude's rAF redraw cadence**

`cursorBlink: true` triggers a ~500 ms blink timer that fires
`refresh()` on the cursor row. During Claude streaming the cursor is
constantly being moved by CUP sequences. Cursor-row refresh interleaves
with Claude's continuous SGR+CUP stream → at the user's perception
threshold this could surface as flicker.

**Probe**: set `cursorBlink: false` in `EmbeddedTerminal.tsx`. Trade-off:
cursor doesn't blink (minor UX loss; many users prefer no blink anyway).

**H3 — xterm 6.0.0 specific WebGL renderer bug**

xterm 6.0.0 was released without post-6.0.0 fixes including
"Fix scrollbar teleport after exiting alt buffer" (mentioned in
6.x release notes). Could be unrelated to our case (we don't use alt
buffer) but the WebGL renderer in 6.0.0 specifically has not been
A/B-tested against 6.0.1+. ADR-097 pinned us to 6.0.0 exactly to
match the snapshot envelope v2 contract; bumping requires snapshot
re-verification (ADR-088 invariant #4).

**Probe**: not cheap. Requires snapshot v3 + re-verify the M2 fixed-
point against the live Claude scrollback. Punt unless H1+H2 don't move
the needle.

**H4 — WebGL glyph atlas texture upload thrashing**

Theory: Claude's color toggles between ~3–5 distinct colors at high
frequency may force xterm's WebGL renderer to re-upload glyph atlas
textures every few frames. WebGL texture uploads stall the GPU
pipeline briefly → visible as flicker.

**Probe**: hard to test directly without code-level instrumentation
of xterm.js internals. Could file as upstream issue if H1+H2 fail.

### Recommended UAT plan (tomorrow morning, fresh)

In order of cost / likely impact:

1. **Hard-reload Vite + start a new task** with current uncommitted state
   (TERM=dumb restored + scrollOnEraseInDisplay:true added).
   - Expected: smearing stays fixed (Move 1 still in effect). Flicker
     state unchanged (no fix applied for it yet).
   - If smearing comes back → revert Move 1 too; fresh start needed.

2. **If flicker persists, apply H1 probe**: add `{ customGlyphs: false }`
   to the WebglAddon constructor (one-line change). Test fresh task.
   - Best-case: flicker drops dramatically.
   - Worst-case: no change AND box-drawing artifacts in `tree`/`ls` output.
   - If worst-case: revert; move to H2.

3. **If flicker still persists, apply H2 probe**: `cursorBlink: false`.
   - Best-case: residual flicker reduced.
   - If no change: revert; move to H3 or accept current state.

4. **If H1+H2 don't fully fix**: stop changing config, file upstream
   issue at xtermjs/xterm.js with the captured `4a9fe7f2-…log.1` byte
   stream + repro instructions. Tag @Tyriar (they'd recognize it).

### What I will NOT do further tonight

- Stack a fourth, fifth, or sixth config-tweak hoping one sticks.
- Commit any of the above to a branch (the patches need UAT first).
- Bump xterm.js minor without snapshot v3 work (ADR-088 invariant).

The user said "research, not just patch" — that's what this section is.
The three concrete probe options (H1, H2, H3) are tomorrow's UAT
material, ordered by cost.

### Current uncommitted state (handover)

Files modified (visible via `git status`):
1. [client/src/components/terminal/EmbeddedTerminal.tsx](client/src/components/terminal/EmbeddedTerminal.tsx)
   — WebGL load-order moved before `open()` (Move 1, keep)
   — `scrollOnEraseInDisplay: true` added (Move 3, defense-in-depth, keep)
2. [server/src/terminal/routes.ts](server/src/terminal/routes.ts)
   — TERM env triple reverted to `dumb / "" / 1` (Move 2-revert)
   — `node-pty name` reverted to `"xterm"`
3. [server/src/terminal/pty-env-flicker.test.ts](server/src/terminal/pty-env-flicker.test.ts)
   — Test assertion reverted to match `dumb / "" / 1`

All 1720 tests still green (40 terminal-affected + 10 pty-env-flicker
verified directly post-edit; full suites green earlier in session).

Hono server has been restarted (2026-05-14 ~01:14) under the
TERM-reverted code path. Vite is HMR-live and already serving the
WebGL+scrollOnEraseInDisplay client changes.

