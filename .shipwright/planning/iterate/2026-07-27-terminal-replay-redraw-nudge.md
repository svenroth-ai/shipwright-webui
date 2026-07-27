# Iterate — BUG: terminal smear survives the renderer flip (post-replay redraw nudge)

- **Run ID:** `iterate-2026-07-27-terminal-replay-redraw-nudge`
- **Intent:** BUG · **Complexity:** medium · **Spec Impact:** NONE
  - Behaviour-restoring only: it makes the embedded terminal render the text it
    was given, which FR-01.28 already promises. No new user-facing affordance,
    no FR row change. (Contrast the preceding run, which ADDED a Settings
    checkbox and was therefore MODIFY.)
- **Affected FRs:** FR-01.28 (Embedded terminal — pty + WebSocket + rendering)
- **Risk flags:** none
- **Related:** #325 (DOM renderer default — smear mechanism #1), ADR-087
  (cell-state snapshot replay), ADR-088 (headless mirror), v0.8.6 AC-2 (the
  no-op resize dedupe this deliberately bypasses), #194 (pty↔xterm width sync)

---

## 1. Symptom (user report, 2026-07-27)

Reported on the build that shipped #325, with a screenshot:

> "schau mal. wieder smearing... auch in einer tabelle... ist der neueste build"

Artifact: `sie und habe` rendered as `sie.undthabe`, `markiert` as `markigrt`
— stale characters standing exactly where spaces belong.

**Deployment was verified first**, because the previous round had been tested
against a stale build: `client/dist` contained the new control and the DOM-default
resolver. So this occurred **with no glyph atlas in play**, which falsifies
"the atlas is the root cause" (#325 / CLAUDE.md rule 28, wording now softened).

## 2. Root cause (F-debug, four phases)

**Phase 1 — Read error.** No exception. The corruption is in the xterm BUFFER,
not in its pixels: the cells genuinely hold the wrong characters.

**Phase 2 — Reproduce.** Achieved deterministically, headless, with no GPU,
browser or Claude auth — a first for this defect class. Using the VERBATIM
redraw bytes from the reported session's pty scrollback
(`025fe6a8-….log` @ byte 319713):

```
ESC[7;3H⚠️ESC[1Cmarkiert.ESC[1CIchESC[1ChatteESC[1CsieESC[1Cund…
bereits ESC[1CrfolESC[1CreichenESC[1CLESC[1Cbel-Lauf      ← skips letters MID-WORD
```

Claude Code repaints **differentially**: it addresses a row with CUP, then emits
`ESC [ 1 C` (**CUF**, cursor-forward) to SKIP every cell it believes already
holds the right glyph. It writes **no spaces at all** — every gap is a hop.
**CUF does not erase**, so the outcome depends entirely on what the row held:

| row already held | result |
|---|---|
| the intended text | renders clean |
| **different text** | **stale characters show — THE DEFECT** |
| blank | renders clean (a skipped blank *looks* like a space) |

That third row is why a fresh terminal never shows it and why it looked
intermittent for months. Pinned in `cuf-stale-cell-repro.test.ts`.

**Phase 3 — Recent changes.** Not a regression of #325 — a second, independent
mechanism that #325 could not have touched (it is renderer-independent).

**Phase 4 — Component boundary.** The divergence source, traced to one line:

1. On re-attach the server restores a **cell-state snapshot** (ADR-087) — a grid
   Claude never drew.
2. `useTerminalSizeSync.onReplaySettled` re-converges and sends a `resize`.
3. A re-attach usually lands at the **same** cols/rows, and
   `PtyManager.resize` (`pty-manager.ts:585`) **returns early on a no-op**:
   ```ts
   if (entry.lastResizeCols === cols && entry.lastResizeRows === rows) return;
   ```
   Its own comment records why node-pty makes this necessary: *"node-pty emit a
   SIGWINCH-driven redraw on EVERY pty.resize call, even when (cols, rows)
   match"* — suppressed in v0.8.6 AC-2 to stop PowerShell banner spam.
4. No `pty.resize` ⇒ **no SIGWINCH** ⇒ Claude never repaints ⇒ its next
   differential repaint runs CUF cell-skips against the foreign grid.

### What VS Code does (asked for explicitly, and it is decisive)

VS Code's `terminalRecorder.ts` records `{ cols, rows, data }` per entry and
**replays the byte stream together with its dimension changes**. The grid is
rebuilt by the very escape sequences that originally built it, so the TUI's model
and the screen cannot diverge — there is no foreign grid, and no nudge is needed.
Our ADR-087 restores a grid instead, which is the trade-off that creates this gap.

Zed's persistent-session RFC states the remedy for exactly the snapshot approach:
after sending the snapshot the daemon **explicitly signals SIGWINCH**, because
the kernel only auto-delivers it when the size actually changes.

Upstream corroboration for BOTH mechanisms (so #325 was not wasted, just
incomplete): claude-code #43273 (*"TUI doesn't redraw after resize… Ink may not
re-render until new state arrives"*) and #49086 for this one; claude-code #59163
and vscode #69665 for the atlas one.

## 3. Fix

A **one-time redraw nudge**, not a permanent full-repaint tax. (My first
recommendation to the user priced in visible flicker; the VS Code/Zed evidence
showed that was too pessimistic, and the recommendation was corrected.)

1. `pty-manager.ts` — new `forceRedraw(taskId)`: re-applies the pty's CURRENT
   dimensions, bypassing the dedupe. Dimension-LESS by design (a caller cannot
   reflow the grid it is repairing); no-op for unknown / torn-down / never-sized
   ptys; swallows a throw from a pty that died mid-call.
2. `ws-upgrade-handler.ts` — a dedicated `{type:"redraw"}` inbound frame, routed
   **after** the existing writer-role gate so a reader can never poke the pty.
3. `useTerminalSizeSync.onReplaySettled` — sends `redraw` after the convergence
   resize, writer-gated, once per settled replay.
4. `ws-capture.ts` — `redraw` added to `ALLOWED_OUTBOUND_TYPES` so the byte-path
   fence keeps meaning "no OTHER frames exist" instead of failing on the new one.

**The dedupe itself is NOT removed** (Chesterton's Fence — v0.8.6 AC-2 is real);
both directions are pinned in `pty-manager.force-redraw.test.ts`.

### Alternatives considered

- **Force a full repaint after every resize/replay.** Rejected: reintroduces the
  flicker `CLAUDE_CODE_NO_FLICKER` exists to prevent (ADR-095/098), for no gain
  over a one-time nudge.
- **Drop the no-op dedupe.** Rejected: re-creates the v0.8.6 banner spam on every
  attach storm (StrictMode double-mount).
- **Switch replay to VS Code's byte-stream-with-dimensions model.** The
  structurally cleanest answer, but it retires ADR-087/092 and DO-NOT #20 — far
  beyond a bug fix. Recorded as follow-up.
- **Send dimensions with the redraw frame.** Rejected: a caller able to pick a
  size could reflow the very grid it is repairing.
- **Chase the alt-screen lead first** (the reported session showed `?1049h` × 0
  while others showed 1). Deferred — a real correlation, but the resize-dedupe
  chain is proven end-to-end and this is not needed to close it.

## 4. Acceptance Criteria

- [ ] **AC-1:** The corruption mechanism is reproduced deterministically and
  pinned: identical CUF bytes render clean onto an agreeing/blank row and
  CORRUPT onto a row holding different text. (Unit, absolute expectations.)
- [ ] **AC-2:** `PtyManager.resize` still dedupes a no-op; `forceRedraw`
  re-applies the current dims anyway, and leaves the recorded dims intact so a
  later real resize still lands. (Unit, both directions.)
- [ ] **AC-3:** `forceRedraw` is a no-op for unknown / never-sized / torn-down
  ptys and swallows a resize throw. (Unit.)
- [ ] **AC-4:** `{type:"redraw"}` is accepted inbound, routes to `forceRedraw`
  for a WRITER, and is refused (with `read_only`) for a READER. (Unit.)
- [ ] **AC-5:** A writer emits exactly one dimension-less `redraw` after a
  settled replay, ordered AFTER the convergence resize; a reader emits none;
  `syncSizeNow` alone emits none. (Unit.)
- [ ] **AC-6:** REAL BROWSER: a first attach sends no redraw; a re-attach that
  replays a snapshot sends exactly one, dimension-less, after the resize, and no
  other new outbound frame type appears. Verified LOAD-BEARING by disabling the
  send and rebuilding → FAIL. (E2E.)
- [ ] **AC-7:** Both suites, typechecks and lint stay green; the three touched
  bloat-baseline entries are bumped with justification, not silently.

## 5. Confidence Calibration

- **Boundaries touched:** the terminal WS inbound contract (new frame type);
  pty resize/SIGWINCH seam; client post-replay path. No new file/env boundary,
  no schema change, no new write surface.
- **Empirical probes run:**
  - Confirmed the deployed bundle really carried #325 before diagnosing at all
    (`dist` mtime + string grep) — the previous round had been tested stale.
  - Decoded the real pty scrollback: the raw bytes spell the text **correctly**,
    so the corruption is downstream of the stream and upstream of the renderer.
  - Counted the stream shape: 8814 CUP, **12168 CUF**, 0 `?1049h`.
  - Reproduced the corruption headless from the verbatim bytes (AC-1).
  - Read the pinned `pty-manager.resize` dedupe and confirmed the same-size
    early return is the swallowed signal.
  - Disabled the fix and re-ran the E2E → FAIL (load-bearing).
- **Test Completeness Ledger:** authored at F5.
- **Confidence-pattern check:** depth — the fix targets the divergence signal,
  not another repaint trigger, and the mechanism is now reproducible rather than
  inferred; breadth — server routing, pty bookkeeping, client emission and the
  real-browser wiring each have their own guard, plus the v0.8.6 dedupe is
  pinned against regression in the same file. No `cross_component` machinery.
- **Investigation trap recorded:** grepping the scrollback for the corrupted
  spelling first matched **this session's own log**, where I had quoted the
  screenshot — a circular false positive that briefly inverted the diagnosis.
  Always identify which `<taskId>.log` is the reported session first.

## 6. Follow-up (out of scope)

- Evaluate VS Code's byte-stream-with-dimensions replay as a replacement for the
  cell-state snapshot (would retire ADR-087/092 + DO-NOT #20).
- The alt-screen correlation: `CLAUDE_CODE_NO_FLICKER` is default-ON yet
  `?1049h` counts are mixed across scrollback logs, and the corrupted session
  ran in the main buffer.
- Report upstream: `TextureAtlas.clearTexture()`'s page-0-only early return and
  the never-reset `_requestClearModel` latch (found in the previous run).
