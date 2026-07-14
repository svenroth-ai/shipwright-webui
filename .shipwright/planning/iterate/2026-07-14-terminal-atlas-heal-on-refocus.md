# Iterate: Heal the WebGL glyph atlas on window refocus (not just `refresh`)

- **Run ID:** `iterate-2026-07-14-terminal-atlas-heal-on-refocus`
- **Intent:** BUG
- **Complexity:** medium (history prior; no risk flags)
- **Spec Impact:** NONE — the fix restores behavior FR-01.28 already describes
  (the embedded terminal renders the buffer it holds). No FR row changes.
- **Affected FRs:** FR-01.28
- **Related:** #206 (atlas clear on atlas-mutation events), #167 (activation
  repaint), #146/#147 (refocus/reflow repaint), ADR-099 (WebGL renderer)

---

## 1. Symptom (user report, 2026-07-14)

> "Wir haben Smearing fast 100 % weg. Aber ich habe gerade gesehen, dass es doch
> noch manchmal wenige Buchstaben gibt. Ist eigentlich nur, wenn ich weg war und
> wieder komme."

Screenshot evidence: isolated cells inside an otherwise correct diff render the
**wrong letter** (`eoward thernvutral-canvas"pole`) — a clean letter-for-letter
swap, **not** pixel garbage and **not** a smeared frame. This is the glyph-atlas
corruption class of #206, surfacing on a trigger #206 does not cover.

- **Observed:** after the browser window/tab loses and regains
  visibility/focus, a few cells show a glyph that belongs to a different cell.
- **Expected:** every cell renders the glyph of its own buffer content; a
  visibility/focus restore repaints the viewport truthfully.
- Healed today only by a manual window resize (the known user workaround).

## 2. Root cause (F-debug, four phases)

**Phase 1 — Read error.** No exception; a rendering defect. Error *site* =
`WebglRenderer._updateModel` (draws a cell from a stale atlas coordinate).
Error *source* = the refocus handler that repaints without clearing the render
model / texture.

**Phase 2 — Reproduce.** The GPU-side texture eviction itself is not
reproducible off a real GPU (SwiftShader does not evict; `requires-physical-device`
— same residual as #206). What *is* deterministically reproducible, and is the
actual defect, is the **wiring**: fire `focus` / `visibilitychange` /
`pageshow` on a mounted terminal and observe that `term.clearTextureAtlas()` is
**never** called while `term.refresh()` is called three times. That is the RED
test (Step 4) — it pins the root cause, not the symptom.

**Phase 3 — Recent changes.** **Not a regression.** `git log` on the three heal
files: the refocus/activation path has only ever called `term.refresh`
(#146 → #147 → #167), and the atlas clear (#206, `webgl-atlas-repaint.ts`) was
wired *exclusively* to xterm's own atlas-mutation events. `useTerminalAppearance`
(#201) carried its `next === currentRef.current` early-return from birth, so a
theme re-apply never accidentally healed a refocus either. The gap has existed
since WebGL adoption (ADR-099); it only became *visible* once the four smear
classes were fixed and nothing else masked it.

**Phase 4 — Component boundary.** Traced, source-verified against the installed
`@xterm/addon-webgl`:

```
window focus/visibilitychange/pageshow
  → useTerminalResize repaint()            safeFit + term.refresh(0, rows-1)
  → activation-repaint schedule()          term.refresh × 2 (130 ms, 350 ms)
  → RenderService.refreshRows
  → WebglRenderer.renderRows
  → glyphRenderer.beginFrame()             returns _requestClearModel
                                           → FALSE (no atlas page add/merge)
  → _updateModel(start, end)               ← BOUNDARY: good input, bad output
                                             cached model cell "looks unchanged"
                                             → drawn from its STALE atlas coord
```

`_clearModel` runs **only** when the atlas itself requests it
(`beginFrame()` → `_requestClearModel`, i.e. page add/merge), or on resize / DPR
change / colour change. Verbatim from the installed bundle:

```js
clearTextureAtlas(){ this._charAtlas?.clearTexture(), this._clearModel(!0), this._requestRedrawViewport() }
_clearModel(e){ this._model.clear(), e && this._glyphRenderer.value?.clear() }
```

**Root-cause statement (one sentence):** the window-refocus heal path repaints
with `term.refresh`, which takes the incremental `_updateModel` route and skips
"unchanged-looking" cells, so a texture the browser evicted/repacked while the
window was backgrounded is never re-uploaded and never re-resolved — only
`term.clearTextureAtlas()` (atlas texture **+** render model **+** full redraw)
heals it, and nothing on the refocus path calls it.

Two corollaries that make the gap airtight:
- `onContextLoss` does **not** fire — the WebGL *context* survives; only its
  texture content goes stale.
- `useTerminalAppearance` bails at `next === currentRef.current` when the theme
  is unchanged (the normal refocus), so no `term.options.theme` reassignment →
  no `onChangeTextureAtlas` → the #206 heal never runs.

## 3. Acceptance criteria

- **AC-1** Both re-show paths trigger the **existing** deferred, coalesced atlas
  heal (`term.clearTextureAtlas()`), in addition to the current refit + refresh
  passes: (a) a window visibility / focus / bfcache restore, and (b) the in-app
  Transcript→Terminal tab activation (user decision 2026-07-14 — belt-and-braces,
  see §5).
- **AC-2** A burst of restore events (`focus` + `visibilitychange` + `pageshow`
  fired together) collapses into **exactly one set of trailing passes** — the
  work is bounded by the pass count, never multiplied by the event count. The
  heal rides **every** pass in that set (two shots: 130 ms + 350 ms — see §5,
  doubt-review MED), so one re-show costs two clears, not two per event.
- **AC-3** The heal is a no-op when the terminal is disposed / mid-dispose, and
  in the DOM-renderer arm (no WebGL addon → no heal handle → no call).
- **AC-4** The #206 fences hold: no `onAddTextureAtlasCanvas` subscription, the
  heal stays deferred (never synchronous inside the event handler), and it is
  never wired to the data/scroll paths.
- **AC-5** In a real browser, a visibility restore bumps
  `window.__embeddedTerminalAtlasRepaints` and the count stays **bounded**
  (proves the heal fires *and* that no feedback loop was introduced).

## 4. Affected boundaries

| Boundary | Touched? | Note |
|---|---|---|
| Serialized I/O (files, env, JSON) | no | no `touches_io_boundary` |
| HTTP/WS message contract | no | no envelope change |
| GPU renderer ↔ xterm public API | **yes** | `Terminal.clearTextureAtlas()` (public, already used by #206) |
| React hook ↔ xterm handle | **yes** | new optional heal ref, mirrors `settleArmRef` |

## 5. Mini-plan

**Chosen — reuse the #206 fence, extend its trigger surface.**

1. `webgl-atlas-repaint.ts` — `attachWebglAtlasRepaint()` additionally returns
   its existing `heal` closure: `{ dispose, heal }`. No new logic; `heal`
   already carries the `pending` coalescing, the `disposed` guard, the
   `try/catch`, and the `__embeddedTerminalAtlasRepaints` counter bump.
2. `xtermAddons.ts` — `EmbeddedXtermHandle` gains `healAtlas?: () => void`,
   set only in the WebGL arm, and only *after* the addon + attachment succeed
   (undefined in the DOM arm and on WebGL-unavailable fallback).
3. `EmbeddedTerminal.tsx` — hold it in `atlasHealRef` (exactly like
   `settleArmRef`), null it in the cleanup **before** `handle.dispose()`.
4. `activation-repaint.ts` — the heal is invoked from **every staggered pass**
   (130 ms + 350 ms; see the correction below). This is the single call point,
   and it covers **both** re-show paths for free: `useTerminalResize` already
   calls `activationRepaintRef.current?.schedule()` from the tab-activation
   effect *and* the window visibility/focus/pageshow effect. `schedule()`
   cancels a pending set before re-arming, so an event burst costs one set of
   passes, not one per event (AC-2).
5. `useTerminalResize.ts` — passes `atlasHealRef` into `createActivationRepaint`,
   gated on `active` (read at fire time — the component stays mounted behind the
   inactive tab). No new event wiring; the existing `safeFit` → `refresh` →
   settle-arm → activation-repaint order is preserved verbatim.

**Why the trailing passes, not a microtask (external plan review, gemini MED-2 /
openai MED-2).** `clearTextureAtlas()` clears the model and *requests* a viewport
redraw, which the RenderService serves on a subsequent animation frame. A heal
fired at microtask time on a just-un-hidden (`display:none → block`) canvas
repaints into a surface that has not composited at its real size. The trailing
passes are the composite-settled window this module already exists to provide.

**Why EVERY pass, not just the last (doubt-review MED — a correction to the
above).** The first implementation healed only on the trailing pass, on the
theory that an early clear would be *wasted **and** unrecoverable* — leaving a
freshly-populated model no later `refresh` could fix. The second half of that is
**false**, and the doubt-review disproved it against the installed
`@xterm/addon-webgl` (re-verified here): `clearTextureAtlas → _clearModel(true) →
GlyphRenderer.clear()` sets `version = -1` on every atlas texture, and the next
frame re-uploads each page whose version differs (`pages[i].version !==
_atlasTextures[i].version → texImage2D`). Model and atlas are therefore
**consistent after any clear** — an early heal is redundant, never poisoning.

That makes the hardening free, and it buys the thing that actually matters for
this bug: a **second shot** if the compositor is late. A single fixed 350 ms
deadline is precisely the fragility #167 already learned to avoid — it shipped
*two* refresh passes for the same reason. Under the old single-shot design, a
slow ANGLE surface re-creation past 350 ms would leave the corruption on screen
until the next re-show — i.e. exactly the intermittent symptom the user reported.
The heal is still never synchronous on the event: that would be a third clear
with nothing to gain (the first pass is only 130 ms away).

**Alternative considered — call `term.clearTextureAtlas()` directly from
`useTerminalResize`.** Rejected: it duplicates the deferral / coalescing /
dispose-cancel fence that #206 established (the ADR is explicit that a
synchronous or uncoalesced clear is *worse than the bug*), it would fire in the
DOM-renderer arm too, and it bypasses the counter that E2E spec 94 reads. Two
heal implementations is precisely the drift #206 warned about.

**Trigger scope — user decision (2026-07-14): heal on BOTH re-show paths.** The
reported trigger is the window restore; the in-app Transcript→Terminal activation
is covered too, deliberately, as a belt-and-braces measure. Cost is one atlas
re-raster per re-show — the same work a manual resize already does, and it is
only ever paid on a user-initiated layout/visibility event, never on the data or
scroll paths (AC-4). The alternative (window-restore only) was offered and
declined: a tab switch shares the same `display:none → block` composite and the
same cached render model, so the failure mode is not structurally excluded there
— it merely has no report yet. YAGNI is knowingly traded for coverage here, in a
class of bug that has cost six prior rounds.

## 6. Test plan

| Layer | Test |
|---|---|
| Unit (RED first) | `useTerminalResize.repaint.test.ts` — a `focus` / `visibilitychange` / `pageshow` restore **and** a tab activation each call the atlas heal; a hidden `visibilitychange` does not; disposed → no call (AC-1, AC-3) |
| Unit | `xtermAddons.atlas.test.ts` — the returned `heal` coalesces a burst into one `clearTextureAtlas` and is cancelled by `dispose()` (AC-2, AC-3) |
| Unit (fence) | existing atlas tests keep proving: no `onAddTextureAtlasCanvas` subscription, deferred never synchronous (AC-4) |
| E2E (real Chromium) | flow spec 94 — a visibility restore bumps `__embeddedTerminalAtlasRepaints`; count stays bounded (AC-5) |
| Real device | the *visual* kill on the user's GPU: `requires-physical-device` (SwiftShader cannot reproduce GPU-specific corruption — same residual as #206) → user UAT after deploy |

## 7. External plan review — resolutions

Two reviewers (gemini + openai via openrouter), `external_review.py --mode iterate`.

| # | Finding | Sev | Resolution |
|---|---|---|---|
| gemini-2 / openai-2 | A heal fired before the un-hidden canvas composites is wasted, and the later `refresh` passes cannot recover it | MED | **ACCEPTED — design changed.** Heal moved to the last trailing pass of `activation-repaint` (see §5). This was a real defect in the original plan: the fix would have been a no-op on the tab-activation path. |
| openai-3 | Changing the `attachWebglAtlasRepaint` return contract may affect other callers | MED | Inventoried: exactly one production call site (`xtermAddons.ts`) plus the atlas unit test. `heal` is additive (`{ dispose }` → `{ dispose, heal }`); `healAtlas` is assigned only after the addon + attachment succeed, and nulled before `handle.dispose()`. |
| openai-4 | "Exactly one heal" could break if `clearTextureAtlas()` itself re-fires an atlas-mutation event | MED | Source-checked: `TextureAtlas.clearTexture()` fires no emitter; a post-clear re-raster can only fire `onAddTextureAtlasCanvas`, which is deliberately NOT subscribed (#206 fence). Pinned by a unit test: one restore burst → exactly one `clearTextureAtlas` after all deferred work drains. E2E keeps the bounded-counter guard. |
| openai-5 / gemini-4 | A heal queued just before unmount could land on a torn-down terminal | LOW | Already guarded (`disposed` re-checked inside `flush`, and `dispose()` cancels). Now pinned by a test: `heal()` → dispose → drain → `clearTextureAtlas` never called. |
| openai-1 | `pageshow` also fires on the initial (non-bfcache) page presentation | MED | **Reviewed, no gate added.** The existing `document.hidden` guard already covers focus-while-hidden. A mount-time heal is a no-op in practice: `clearTexture()` early-returns on an unrastered atlas (`pages[0].currentRow` still at origin), and the hook's listeners only exist after the terminal mounts, which is after initial presentation. Gating `pageshow` on `event.persisted` would also silently change the existing #146 refresh behavior (Chesterton's fence). The E2E asserts a **delta** against a pre-restore baseline, so the counter stays unambiguous. |
| gemini-1 | `refresh` + `clearTextureAtlas` double-paint on restore | LOW | Accepted as-is (reviewer concurs). One extra paint on a user-initiated, low-frequency event; the `refresh` passes are retained deliberately (they serve the DOM-renderer arm, which has no heal). |
| gemini-3 | Pass the heal ref explicitly, never a module-level variable | LOW | Already the design — `atlasHealRef` is a per-instance ref threaded through the hook, mirroring `settleArmRef`. |
| openai-6 | Counter must stay a bare number | LOW | Unchanged — `__embeddedTerminalAtlasRepaints` is an integer counter (#206). |

## 8. Code review — resolutions

Internal code-reviewer (Stage 2) + external `external_review.py --mode code`.

| # | Finding | Sev | Resolution |
|---|---|---|---|
| cr-1 | **Anti-ratchet BLOCK**: `EmbeddedTerminal.tsx` is baselined at 314 lines; the diff pushed it to 326, so the pre-commit hook would reject the commit | HIGH | **Fixed.** My three new comment blocks collapsed to one-liners pointing at the canonical rationale, and two pre-existing blocks (OSC-52, touch-scroll) trimmed to references — both duplicated their module headers verbatim. File is back to exactly 314; `anti_ratchet_check.py --worktree` exits 0. **No code changed in the trimmed regions, comments only.** |
| cr-2 | AC-3 unmet: `healAtlas` was assigned BEFORE `term.loadAddon(webgl)` — but `loadAddon` is where `WebglAddon.activate()` throws on a GPU-blacklisted host, so the DOM-fallback arm still advertised a heal | MED | **Fixed.** `healAtlas` is now assigned only after `loadAddon` returns; the catch drops both the heal and the subscription. |
| cr-3 | No CI test pinned the root cause on the real component — the two halves of the seam (`atlasHealRef.current = handle.healAtlas`, and the ref passed to the hook) were covered by nothing that runs in CI (Playwright is not a CI gate) | MED | **Fixed.** New `EmbeddedTerminal.atlas-heal.test.tsx`: mounts the real component, returns to the window, asserts the real `term.clearTextureAtlas()` runs exactly once. Deleting either wiring line now reds CI. |
| cr-4 | The trailing pass was identified by delay VALUE (`delay === lastDelay`) — a future duplicate value would fire two heals | LOW | **Fixed** — index-based. |
| cr-5 | `flush()` reset `pending` BEFORE the clear: a future xterm that emitted an atlas event *from* `clearTextureAtlas()` would re-enter and microtask-loop (a hung tab) | LOW | **Fixed** — `pending` now resets in a `finally`, so a self-emitted event is dropped by the guard. Unreachable today; no longer pin-dependent. |
| cr-6 | The heal fired on a window refocus even while the Terminal tab was HIDDEN (the component stays mounted behind `display:none`) — a full re-raster into a canvas that never composites | LOW | **Fixed** — the heal is gated on `active`, read at FIRE time. Nothing is lost: switching to the Terminal tab re-schedules and heals with the canvas visible. Pinned by two tests. |
| cr-7 | `atlasHealRef.current = null` sat at the end of a try whose earlier statements can throw | LOW | **Fixed** — moved out of the try, next to `disposedRef.current = true`. |
| cr-8 | Ref-in-a-ref (`atlasHealLatestRef`) — inconsistent with the sibling `settleArmRef`, bought nothing | LOW | **Fixed** — removed. |
| cr-9 | The E2E asserted an EXACT counter delta on a probe SHARED with the event-driven heal — an unrelated atlas mutation in the window would red the spec for a non-defect | LOW | **Fixed** — the browser now asserts `>= 1` plus the settled/bounded check (what only a real browser can prove); "exactly one per burst" stays pinned deterministically in the unit suites. |
| ext-1 | **Context-loss race**: a heal queued microtasks before a GPU context loss still ran (and still bumped the probe) after xterm had fallen back to the DOM renderer; and a loss *during* `loadAddon` was overwritten by an unconditional `webglAtlasLive = true` | MED | **Fixed.** The context-loss handler now disposes the fence (which cancels queued work) and sets a `contextLost` flag; `webglAtlasLive = !contextLost`. Three new tests: queued-heal-then-loss, heal-after-loss, loss-during-activation. |
| ext-2 | Those context-loss paths had no test | MED | **Fixed** — see above. |

Accepted, not fixed: each trailing pass calls `term.refresh` immediately before `clearTextureAtlas()` (which forces its own redraw) — one redundant paint per pass. The refresh is retained deliberately: it is the DOM-renderer arm's only repaint (Chesterton's fence, #146/#167). `xtermAddons.atlas.test.ts` sits at 308 lines, 8 over the guideline; splitting it would mean duplicating ~90 lines of xterm mocks into a second file, which is the worse trade.

## 8b. Doubt review (Stage 3, adversarial) — resolutions

| # | Doubt | Sev | Resolution |
|---|---|---|---|
| d-1 | The reviewed tree may not be the tree that gets committed — the working tree changed mid-review (the context-loss fix landed while it was reading), and the git INDEX still held the pre-remediation blob, which fails two of its own new tests | HIGH | **Real and caught in time.** The index was stale (staged before the external-code-review fixes). Everything is re-staged from the final tree, and the full suite + E2E re-run against it (see §6). Had this shipped, the commit would have carried a red suite. |
| d-2 | The heal got ONE shot (350 ms) while the refresh gets two — and the justification for that asymmetry does not survive a source check | MED | **Accepted — design changed again.** Source re-verified independently: `GlyphRenderer.clear()` invalidates every atlas texture (`version = -1`) and the next frame re-uploads, so an early clear is redundant, **not** poisoning. The heal now rides **every** trailing pass. This directly addresses "manchmal noch wenige Buchstaben": a single fixed deadline had no recovery if the compositor ran late. |
| d-3 | `onContextLoss` fires **3 s after** the real `webglcontextlost` (the addon preventDefaults and waits for a restore), so `webglAtlasLive` has a 3-second blind window in which a heal calls into a dead context and still bumps the probe | LOW/MED | **Comment corrected** (verified in the bundle: `setTimeout(fire, 3e3)`). No functional change: the GL calls are silent no-ops and xterm self-heals on restore via `handleResize → _clearModel`. The misleading claim was in the comment, and that is what was wrong. |
| d-4 | `activeRef.current = active` was a render-phase ref write (not rolled back if React 19 discards a concurrent render) | LOW | **Fixed** — moved into `useEffect([active])`. Reads happen 130/350 ms later, so commit-time is soon enough. |
| d-5 | The unit harness seeds a live `termRef` before the hook renders, so it models a mount-time schedule the real component does not have (there, the hook's effects run before the xterm mount-effect → `termRef` is null → the activation pass early-returns) | LOW | **Documented** in the harness header + the affected test comments, so no one reads "heals on mount" as a claim about production. |

Held under attack (reviewer could not break, invariants stated): StrictMode / remount stale-closure (every closure reads through a ref repointed synchronously inside the same commit as the dispose); coalescing (`pending` cannot stick — `finally` resets it on every path, including the disposed early-return); and all four prior smear fences (#28 `convertEol`, #146, #147, #167) plus the #206 atlas fences. The reviewer diffed both trimmed comment regions against `main` and confirmed the code below them is **byte-identical**.

Flagged for later, not this iterate: `EmbeddedTerminal.tsx` is now at exactly its baseline (314) — this change paid for its code by deleting rationale. The next iterate touching it needs a retirement plan, not another round of comment shaving. → decision-drop.

## 9. Confidence Calibration

- **Boundaries touched:** GPU renderer ↔ xterm public API (`Terminal.clearTextureAtlas()`); React hook ↔ xterm handle (new optional heal ref); component lifecycle (mount/dispose, context loss). No serialized I/O boundary, no HTTP/WS contract → `touches_io_boundary` not set.

- **Empirical probes run:**
  1. *Does `refresh` clear the render model?* — Read the installed `@xterm/addon-webgl` bundle. **No**: `clearTextureAtlas(){ this._charAtlas?.clearTexture(), this._clearModel(!0), this._requestRedrawViewport() }`, while `renderRows` only reaches `_clearModel` when `beginFrame()` returns `_requestClearModel` (page add/merge). `refresh` takes `_updateModel(start,end)`. **Confirms the root cause; falsifies "just add another refresh".**
  2. *Is it a regression?* — `git log` on all three heal files. **No**: the re-show path only ever called `refresh` (#146→#147→#167); the atlas clear (#206) was only ever event-driven; `useTerminalAppearance` (#201) carried its early-return from birth. Gap existed since ADR-099.
  3. *Does the heal reach the LIVE renderer on a real GPU?* — e2e spec 94 against a real Chromium: `renderer=webgl canvases=3`, re-show delta = **1**, settled count unchanged → heals once, does not loop.
  4. *Is the trailing-edge timing load-bearing?* — E2E measures the counter immediately after the event: **unchanged** (`immediate == baseline`), then +1 after the pass. The synchronous heal the first draft would have shipped is empirically absent.
  5. *Would the anti-ratchet hook accept the commit?* — `anti_ratchet_check.py --worktree` → exit 0.

- **Test Completeness Ledger** — enumeration basis: the 5 ACs plus every branch the review rounds added (14 behaviors).

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1 | Window focus/visibilitychange/pageshow → atlas heal | tested | `useTerminalResize.atlas-heal.test.ts` (3 tests) |
| 2 | Tab activation → atlas heal | tested | `useTerminalResize.atlas-heal.test.ts`, `EmbeddedTerminal.atlas-heal.test.tsx` |
| 3 | Heal is NOT synchronous; rides EVERY trailing pass (two shots) | tested | `useTerminalResize.atlas-heal.test.ts` (2), `activation-repaint.test.ts`, `EmbeddedTerminal.atlas-heal.test.tsx` |
| 4 | Event burst → ONE set of passes (bounded work, not per-event) | tested | `useTerminalResize.atlas-heal.test.ts`, `activation-repaint.test.ts`, `xtermAddons.atlas.test.ts` |
| 5 | Hidden tab / hidden document → no heal | tested | `useTerminalResize.atlas-heal.test.ts` (3), `EmbeddedTerminal.atlas-heal.test.tsx` |
| 6 | `active` is read at FIRE time, not schedule time | tested | `useTerminalResize.atlas-heal.test.ts` |
| 7 | Disposed / unmounted → no heal | tested | `useTerminalResize.atlas-heal.test.ts` (2), `activation-repaint.test.ts`, `xtermAddons.atlas.test.ts`, `EmbeddedTerminal.atlas-heal.test.tsx` |
| 8 | DOM-renderer arm → `healAtlas` undefined, refresh passes still run | tested | `xtermAddons.atlas.test.ts`, `activation-repaint.test.ts` |
| 9 | WebGL activation throws → no heal handle | tested | `xtermAddons.atlas.test.ts` (loss-during-activation) |
| 10 | Context loss → heal retracted; queued heal cancelled | tested | `xtermAddons.atlas.test.ts` (2) |
| 11 | Heal + concurrent atlas mutation → one clear | tested | `xtermAddons.atlas.test.ts` |
| 12 | A throwing heal does not break the pass | tested | `activation-repaint.test.ts`, `xtermAddons.atlas.test.ts` |
| 13 | The heal reaches the LIVE WebGL renderer and does not feedback-loop | tested | e2e flow spec 94 (real Chromium, executed — see §6) |
| 14 | The corruption is VISUALLY gone on the user's GPU | **untestable** | `requires-physical-device` — SwiftShader does not evict/repack GPU textures, so headless Chromium cannot reproduce GPU-specific corruption (same residual as #206/#167). Resolved by user UAT after deploy. |

**untested-testable: 0.**

- **Confidence-pattern check.**
  *Depth (asymptote):* **four** independent review passes, and every one of them changed the artifact — the external plan review caught a design defect that would have made the fix a no-op on the tab path; the code review caught a commit-blocking ratchet plus an unmet AC and an untested seam; the external code review caught a context-loss race; the doubt-review caught a stale git index that would have shipped a red suite, and disproved the very premise the plan review had established (single-shot heal → heal on every pass). Returns have NOT flattened — each lens found something the previous one could not. That is an argument for the review stack, not for my confidence in the first draft.
  *Breadth (coverage):* every re-show trigger, both renderer arms, both failure modes of the WebGL addon (activation throw, context loss), and the lifecycle races (dispose, unmount, fire-time visibility) are covered. The one uncovered claim — "the wrong letters are actually gone on your screen" — is uncoverable in software and is explicitly handed to UAT rather than asserted.
  *Not claimed:* that this eliminates every atlas corruption. Two holes are named in §10 and left open deliberately.

## 10. Known residue (not fixed here)

- **Occlusion without a focus/visibility event** — another window covers the browser, or an OS desktop switch: Chromium can still repack the texture while no event fires, so no heal runs. The user's reported flow (leaving to another app and returning) *does* fire `focus`, so this is out of scope; it would need a periodic or paint-triggered probe, which is a bigger, costlier design.
- **Corruption appearing while the window stays foregrounded** and no atlas event fires: unchanged from before — it persists until the next re-show or resize.
