# Iterate — BUG: terminal smear returns after resize-then-scroll (GPU off by default)

- **Run ID:** `iterate-2026-07-24-terminal-scroll-atlas-smear`
- **Intent:** BUG · **Complexity:** medium · **Spec Impact:** MODIFY (FR-01.28)
  - The rendering fix alone would be NONE (it restores the faithful rendering FR-01.28
    already promises). But the change also ADDS a user-facing affordance — the
    Settings → Terminal "Use GPU acceleration" checkbox — and a new control a user
    can see and operate is a spec-visible change, so the honest classification is
    MODIFY. FR-01.28's `Updates:` row records both halves.
- **Affected FRs:** FR-01.28 (Embedded terminal — pty + WebSocket + rendering)
- **Risk flags:** none
- **Related:** #146/#147 (refocus/reflow repaint), #167 (activation repaint), #175, #206 (atlas clear on atlas-mutation), #215 (atlas heal on refocus), ADR-099 (WebGL renderer), iterate-2026-06-23 (diagnostic renderer toggle)

---

## 1. Symptom (user report, 2026-07-24)

> "Ich habe wieder smearing. Auf dem mac. Aber auch auf Windows ist es mir
> aufgefallen. […] und scrolling macht es dieses mal schlimmer. das hatte ich
> noch nie. Terminal grösser oder kleiner machen. und dann scrollen.
> verschmieren wieder da."

Screenshot evidence: a clean **letter-for-letter swap** inside otherwise
correctly-drawn cells — `undeclarwd` (for *undeclared*), `6bare skiptblocks`,
`66 trrms +tthe register`, `codl-confirmed` — plus stray glyphs rendered at
positions that hold no such character (`h  p  r` on the line below the row they
belong to, and a lone `d` outside the table's right border).

This is the **glyph-atlas corruption** class (#206 / #215), NOT the stale-GPU-
framebuffer class (#146/#147/#167). A stale framebuffer shows a *ghost of the
previous frame*; this shows *the wrong glyph in a correctly positioned cell*,
which can only come from a cell's texture coordinate pointing into a repacked
or cleared atlas.

**New in this report:** a deterministic user-side trigger —
**resize the terminal, then scroll** — and it reproduces on **both** macOS and
Windows, i.e. it is not a single-GPU/driver artifact.

## 2. Root cause (F-debug, four phases)

**Phase 1 — Read error.** No exception; a rendering defect. Error *site* =
`WebglRenderer._updateModel` drawing a cell from a stale atlas coordinate.
Error *source* = the scroll path, which is the only repaint path in this
codebase with no atlas heal wired to it.

**Phase 2 — Reproduce.** The GPU-side texture eviction is not reproducible off
a real GPU (SwiftShader does not evict — same residual as #206/#215;
`requires-physical-device`). What IS deterministically reproducible, and is the
actual defect, is the **wiring**: drive a scroll on a mounted terminal and
observe that `term.clearTextureAtlas()` is never called while `term.refresh()`
is. That is the RED test — it pins the root cause, not the symptom.

**Phase 3 — Recent changes.** Not a regression. The gap has existed since
`scroll-repaint.ts` was written (iterate-2026-06-09): it has only ever called
`term.refresh`. It became *visible* now because #206/#215 closed the refocus
and activation triggers, leaving scroll as the last unhealed one.

**Phase 4 — Component boundary.** Traced and **source-verified against the
installed `@xterm/addon-webgl@0.19.0`** (not against our own comments):

1. **`scroll-repaint.ts:86` calls only `term.refresh(0, rows-1)`.** That routes
   through `RenderService.refreshRows` → `WebglRenderer._updateModel`, which
   **skips cells whose `code/fg/bg/ext` match the cached model**. A wrong glyph
   in the atlas is invisible to that check, so `refresh` provably cannot heal
   this class. Every other repaint path (`activation-repaint.ts`,
   `useTerminalResize`) additionally calls `healAtlas()`; scroll never does.

2. **A resize maximises the exposure.** `WebglRenderer.handleResize`
   (`WebglRenderer.ts:173-204`) acquires a **fresh, empty atlas** for the new
   cell size and ends with `_clearModel(false)`. Subsequent scrolling then
   floods that empty atlas with newly rasterised glyphs → `_createNewPage()` →
   page merges (`TextureAtlas.ts:155-196`), which is exactly the operation that
   reassigns existing glyph coordinates.

3. **Our heal is a no-op in precisely that multi-page state.**
   `TextureAtlas.clearTexture()` (`TextureAtlas.ts:138-141`) early-returns on
   `this._pages[0].currentRow.x === 0 && …y === 0` — a guard that inspects
   **page 0 only**. With a multi-page atlas, pages 1..N are neither cleared nor
   given the `version++` that `GlyphRenderer.render` (`GlyphRenderer.ts:361`)
   requires before it re-uploads a texture. So `term.clearTextureAtlas()`
   silently does nothing for the pages that actually hold the corruption.

Two further upstream defects found while verifying, recorded because they
bound how much any heal-based approach can ever achieve:

- `TextureAtlas.beginFrame()` returns `_requestClearModel` but **never resets
  it** (`:133-136`; set `true` at `:195` and `:798`) — a one-way latch.
- `AtlasPage.clear()` resets `currentRow` and bumps `version` but does **not**
  reset `glyphs` / `_usedPixels`, so the merge heuristics keep running on
  stale accounting.

### Why the fix is not another trigger patch

This is the **eighth** iterate on this class (convertEol → #146 → #147 → #164 →
#167 → #175 → #206 → #215). Each closed one trigger; each subsequent user
report found the next. The upstream xterm.js API documents
`clearTextureAtlas` itself as a **workaround** for a Chromium/NVIDIA texture-
corruption bug — i.e. the atlas is unreliable by upstream's own admission, and
enumerating triggers is unbounded work.

**VS Code — which runs the same xterm.js — does not enumerate triggers.** It
keeps exactly one corruption remedy (`forceRedraw() { this.raw.clearTextureAtlas(); }`)
and adds a *structural* escape hatch we lack: the user-facing
`terminal.integrated.gpuAcceleration` setting (`auto|on|off|canvas`) plus a
static `XtermTerminal._suggestedRendererType = 'dom'` that permanently drops
the workbench to the DOM renderer once WebGL misbehaves. The widely-reported
community fix for "Claude Code garbles the VS Code terminal" is to turn GPU
acceleration off.

The DOM renderer has **no texture atlas at all**, so this entire defect class
becomes structurally impossible rather than incrementally patched.

## 3. Fix

**Primary — flip the default, keep the choice (VS Code parity).**

1. `terminal-renderer.ts` — default flips `webgl` → `dom`. The existing
   query-param-over-storage precedence and the storage key are unchanged, so a
   user who already pinned a value keeps it; the opt-in value is now `webgl`.
   Header rewritten from "DIAGNOSTIC A/B" to the real, supported setting.
2. `xtermAddons.ts` — `createEmbeddedXterm` takes the renderer as an explicit
   parameter (defaulting to the resolver) instead of reading global state
   internally, so both arms stay unit-testable.
3. `TerminalSettingsCard.tsx` — a visible "Use GPU acceleration" checkbox under
   Appearance, with an honest hint that it applies to the next terminal open
   (swapping renderers requires rebuilding the terminal).

**Secondary — do not knowingly ship the proven hole in the opt-in arm.**

4. `scroll-repaint.ts` — the trailing (settled) scroll pass also invokes the
   injected `healAtlas()`. Only the trailing pass, never the per-frame one: a
   `clearTextureAtlas` per animation frame would re-rasterise the screen on
   every wheel tick.
5. `webgl-atlas-repaint.ts` — correct the header's factual error: it claims
   `handleResize → _clearModel(true)`; the pinned 0.19.0 source says
   `_clearModel(false)`. Record the `clearTexture()` page-0-only early-return
   as the reason the heal is best-effort, not a guarantee.

### Alternatives considered

- **Keep WebGL, only add the scroll heal (item 4 alone).** Rejected as the
  primary fix: it is the same "close the next trigger" move that has now failed
  seven times, and item 3 above proves the heal itself is a no-op in the
  multi-page atlas state that scrolling produces. Retained as a *secondary*
  measure for the opt-in arm.
- **Remove the accumulated heal machinery** (#146/#147/#167/#206/#215).
  Rejected — Chesterton's Fence: WebGL stays reachable via the toggle, so each
  heal remains load-bearing for that arm. Their status changes from primary
  defence to best-effort, not their necessity.
- **Auto-fallback after N context losses (VS Code's `_suggestedRendererType`).**
  Deferred: it only helps the opt-in arm, and context loss is not this defect
  (the context survives; the atlas corrupts). Recorded as follow-up.
- **Remount the terminal live on toggle.** Rejected for a bugfix iterate —
  a renderer swap needs a full xterm rebuild + WS re-attach + snapshot replay;
  the UI states "next open" instead.

## 4. Acceptance Criteria

- [ ] **AC-1:** With nothing configured, the embedded terminal uses the **DOM**
  renderer; no WebGL addon is constructed. (Unit: resolver default; E2E 93:
  real-browser console `renderer=dom` + no WebGL `<canvas>`.)
- [ ] **AC-2:** `localStorage["shipwright:terminal-renderer"]="webgl"` (or
  `?terminalRenderer=webgl`) opts back in to WebGL, query winning over storage.
  Any unknown/malformed value resolves to `dom`. (Unit.)
- [ ] **AC-3:** Settings → Terminal shows a "Use GPU acceleration" checkbox that
  reflects the stored value and persists a change. (Unit + E2E.)
- [ ] **AC-4:** `createEmbeddedXterm` accepts an explicit renderer; the WebGL arm
  still loads the addon BEFORE `term.open` (ADR-099) and still registers
  `onContextLoss` + the atlas fence. (Unit.)
- [ ] **AC-5:** In the WebGL arm, the trailing scroll repaint invokes
  `healAtlas()` exactly once per settle; the per-frame pass never does. In the
  DOM arm no heal is invoked (none exists). (Unit.)
- [ ] **AC-6:** Full client suite + typecheck + lint green; the
  `task-detail-terminal` visual baseline is regenerated for the new renderer.

## 5. Confidence Calibration

- **Boundaries touched:** client-side renderer selection (localStorage +
  query param); xterm addon construction; scroll repaint timing. No server
  change; no new IO/env/file boundary.
- **Empirical probes run:** see §2 Phase 4 — all four claims read directly out
  of `client/node_modules/@xterm/addon-webgl@0.19.0` sources, with file:line
  citations, rather than from this repo's own comments (one of which was found
  to be wrong).
- **Test Completeness Ledger:** authored at F5.
- **Confidence-pattern check:** depth — the fix removes the corrupting
  component instead of adding an eighth trigger heal; breadth — both arms
  (default DOM, opt-in WebGL) are covered by deterministic unit tests plus a
  real-browser E2E. The residual — that the DOM renderer visually eliminates
  the smear on Sven's specific machines — is `requires-physical-device` /
  `requires-manual-visual-judgment` and is the user's confirmation.

## 6. Follow-up (out of scope)

- Auto-fallback to DOM after repeated WebGL context loss (VS Code's
  `_suggestedRendererType` equivalent) for the opt-in arm.
- Upstream: report the `TextureAtlas.clearTexture()` page-0-only early return
  and the never-reset `_requestClearModel` latch to xtermjs/xterm.js.
