# Iterate Spec — Mobile / touch terminal UX adjustments

- **run_id:** `iterate-2026-06-20-mobile-terminal-touch-ux`
- **Intent:** CHANGE (UI/UX), with two embedded BUG fixes
- **Complexity:** medium (classifier said `small`; bumped — two bugs in
  load-bearing terminal-render code under CLAUDE.md rule 22, browser + device
  verification required)
- **Spec Impact:** MODIFY (responsive layout + touch behaviour of existing
  surfaces; no new routes/schema)
- **Surface:** web (client-only)
- **Source:** user report after mobile use over Tailscale (2 screenshots).

## Context

User drove the WebUI from an iPhone over Tailscale and reported four
adjustments. Two are pure UI changes verifiable locally (Vite + responsive);
two are touch-rendering bugs whose final confirmation requires the physical
device (out-of-band UAT by the user).

## Acceptance Criteria

### AC-1 — Condense the mobile task-detail header (phone)
On phone widths (`≤767px`) the header chrome above the terminal is roughly
halved so the terminal gets materially more vertical room. Specifically, in
`TaskDetailHeader`:
- breadcrumb (`Projects › <project>`) hidden,
- the meta sub-line (`Started … · last event … · <model>`) hidden,
- title + state badge + Resume CTA stay on a compact row,
- vertical padding/gaps tightened (base `px-3 py-2`, restored to `md:px-6
  md:py-3` at ≥768px so the 768–1023 tablet band keeps the desktop spacing).

> **Build decision (2026-06-20):** the global `MainLayout` phone top bar was
> evaluated and **left unchanged** — it is already minimal (a 44px hamburger
> touch-target + the "Shipwright" label, `px-1`, no excess vertical padding).
> Shrinking it would break the 44px touch-target accessibility floor for ~6px
> of gain; all the reclaimable space is in `TaskDetailHeader`.

The `≥768px` (tablet + `≥1024px` desktop) layout is **byte-identical** (no
visual diff — the change branches solely on `useIsPhoneViewport()` / the
`md:` breakpoint). All hidden info stays reachable (project via the chip menu
/ the desktop breadcrumb; session metadata via the ⋮ → debug panel).

*Verifiability:* unit/RTL test asserting the breadcrumb + sub-line are not
rendered at phone width and ARE rendered at desktop width (jsdom +
`matchMedia` mock). Visual: Vite responsive check at 390px.

### AC-2 — White border + white icon on the touch key bar (`TerminalKeyBar`)
The on-screen key buttons (Esc/Tab/⌃C/arrows/⏎/⌨) get a visible white border
and white label/icon text for readability on the dark bar. Disabled
(read-only reader) state still visibly muted.

*Verifiability:* RTL test asserting the button class carries the
border + white-text utilities; visual check.

### AC-3 (BUG) — Touch scroll works at Claude's resume picker
**Symptom:** at the `--resume` "Load full session / Load summary" prompt, a
finger-pan does not scroll. **Hypothesis:** `touch-scroll.ts routeScroll`
dispatches a synthetic wheel (→ mouse-report) whenever `mouseActive ||
inAltBuffer`; if the picker is in the **normal** buffer with mouse-tracking
on, that wheel is swallowed by Claude instead of panning the scrollback the
user can see. **Fix direction:** route by buffer FIRST — normal buffer →
`scrollLines` (pan the real scrollback); only the **alt** buffer forwards the
wheel/mouse-report (Claude's full-screen TUI). Pure routing logic is
unit-tested; final behaviour at the picker is **device-UAT** (the live
buffer/mouse state at the picker can only be confirmed on the device — if UAT
shows the picker is alt-buffer, a focused follow-up re-scopes the fix).

### AC-4 (BUG) — No input-area smear on tab/visibility transition
**Symptom:** switching Transcript→Terminal, or returning from the iOS home
screen, leaves a smeared input area (doubled separators / ghost glyphs).
**Root cause:** the existing post-layout-change repaints fire on a fixed
130/350 ms trailing timer (`POST_RESIZE_REPAINT_DELAYS_MS`); on a slow mobile
path Claude's async alt-buffer redraw lands *after* that window closes, so the
final stale frame is never repainted (open-loop timing). **Fix:** a
**data-driven** settle-repaint — after a layout-change trigger
(`term.onResize`, tab-activation, visibility/focus restore), keep issuing a
debounced full `term.refresh(0, rows-1)` on each subsequent `onWriteParsed`
until the data stream is quiet (≈settle ms) or a hard cap is hit. This reacts
to the actual redraw instead of guessing its latency, and **supersedes** the
fixed-delay band-aid (no patch-stacking). Unit-tested in isolation
(pattern: `scroll-repaint.ts`); final visual confirmation is **device-UAT**.

## Out of scope
- HTTPS-over-Tailscale clipboard (tracked separately).
- Desktop layout changes.
- Any server/pty change (this is client-render + CSS only).

## Confidence Calibration
- **Boundaries touched:** none of the `touches_io_boundary` producer/consumer
  set — UI render + CSS only. xterm render API (`refresh`/`onResize`/
  `onWriteParsed`/`scrollLines`/buffer type) is the integration surface;
  CLAUDE.md rule 22 (exact-pin, no `windowsMode`, `convertEol:false`)
  unchanged.
- **Empirical probes run:**
  - `onWriteParsed` / `onResize` confirmed present in pinned
    `@xterm/xterm` 6.0 typings (grep of `xterm.d.ts`).
  - Traced the four existing repaint triggers (resize / tab-activation /
    visibility-focus / scroll) — all use fixed-delay `term.refresh`; none is
    data-driven → confirms AC-4 root cause.
  - Traced `active = centerTab === "terminal"` wiring + `forceMount` +
    `data-[state=inactive]:hidden` → confirms tab switch flips `active` and
    toggles `display:none` (AC-4 transition path).
- **Test Completeness Ledger:**

  | Behavior | Disposition | Evidence / reason_code |
  |---|---|---|
  | AC-1 breadcrumb+subline hidden @phone, shown @desktop | `tested` | RTL + matchMedia mock |
  | AC-1 desktop byte-identical | `tested` | RTL (no breadcrumb removal at ≥1024) + visual |
  | AC-2 button border/white-text classes present | `tested` | RTL class assertion |
  | AC-2 on-device contrast/readability | `untestable` | `requires-manual-visual-judgment` |
  | AC-3 routeScroll: normal-buffer pans scrollback even when mouseActive | `tested` | touch-scroll unit test (mock Terminal) |
  | AC-3 actual scroll at the live resume picker | `untestable` | `requires-physical-device` |
  | AC-4 settle-repaint arms on resize, refreshes on writes, disarms on quiet/cap | `tested` | new module unit test (fake term + timers) |
  | AC-4 no visible smear on device transition | `untestable` | `requires-physical-device` |
- **Confidence-pattern check:** depth — root cause traced for both bugs (not
  symptom-patching: AC-4 replaces the fixed timer, AC-3 reorders the routing
  predicate). Breadth — all four items covered; the two device-only behaviours
  are explicitly UAT-gated, not silently skipped. No `cross_component`
  machinery touched (no integration-coverage flag).
