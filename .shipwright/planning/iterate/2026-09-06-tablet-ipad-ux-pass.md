# Iterate Spec — Tablet/iPad UX Pass

- **run_id:** `iterate-2026-09-06-tablet-ipad-ux-pass`
- **Intent:** CHANGE (embeds one root-caused BUG fix — terminal smear-on-tap,
  investigated per the Path-C Iron Law before any fix was written)
- **Complexity:** medium (`classify_complexity.py`: estimate=medium,
  confidence=0.7, prior_source=keyword, risk_floor=trivial, cross_split=false)
- **Spec Impact:** NONE — every change here is a UI-affordance fix or a
  liveness-signalling bug fix; no FR's spec-text contract changes (the tablet
  breakpoint contract itself was already specified in
  `2026-06-14-tablet-responsive-view.md` and `2026-06-15-mobile-tablet-layout-polish.md`
  — this iterate makes existing surfaces conform to that contract, and fixes a
  defect in an unrelated liveness-signalling path). Per
  `feedback_spec_impact_none_for_ui_affordance_removal`: `spec_impact=none` is
  correct whenever the FR's spec text is accurate before AND after the change.
- **Date:** 2026-09-06
- **Reported by:** Sven, in German, translated inline below.

## Problem

Sven reported (verbatim, translated from German), on iPad:

> On the iPad we need comparable fixes to the Mobile View: (1) Title should
> not always be spelled out and wrapped, but truncated to one line and tap to
> see the full title. (2) Settings in the bottom navigation is cut off. (3)
> The whole bar with title, buttons, grading etc. above the terminal needs
> optimizing analogous to Mobile View — currently not on one line and takes
> an insane amount of space. (4) Triage doesn't show all entries on the
> tablet. (5) Look for other things that aren't tablet best practices —
> validate with Playwright, use accessibility standards (cites the Task Modal
> a11y work as the bar). Also: in Ship's Log, the Project Documents area
> doesn't scroll along — only the Log column scrolls; Docs must scroll
> independently. Remove the visible "Project Documents" title.

Mid-session, escalated as the highest-priority item:

> The terminal on the iPad is completely smeared when I tap into it. That's
> almost the most important one. It somehow heals itself again.

## Root Cause Investigation (terminal smear — Path-C Iron Law)

**Read Error / Reproduce:** no console error; user describes a transient
visual corruption on tap-in that self-heals after a few seconds.

**Recent changes:** CLAUDE.md rules 28/29 already document two prior smear
mechanisms (WebGL glyph-atlas corruption; CUF differential-repaint stale-cell
corruption after snapshot restore) — both fixed with dedicated heals. Neither
mechanism matches "heals itself after tapping," which points at something
time-bounded rather than paint-bounded.

**Component-boundary instrumentation:** traced the tap interaction through
`wsLiveness.ts`. `onInteraction` (bound to `keydown`/`pointerdown`, the exact
handler a tap fires) calls `reviveIfStale()` when the socket has been
inbound-silent for `WS_INTERACTION_STALE_MS` (8s) — common after iOS Safari
backgrounds a tab and silently suspends its WebSocket. `reviveIfStale()` sends
a ping and arms a `WS_REFOCUS_PROBE_MS` (4000ms) deadline before declaring the
socket dead, closing it, and calling `scheduleReconnect()` (which DOES set
`reconnecting=true`, driving the existing "Connection lost — reconnecting…"
banner).

**Root cause:** the gap is *before* that point. During the up-to-4-second
probe window, `reconnecting` was never set — only `scheduleReconnect()` sets
it, and that runs *after* the probe already failed. So the user sees a
silent, stale, frozen terminal frame for up to 4+ seconds with zero
indication anything is happening, then it "heals" the instant reconnect +
replay (ADR-087 cell-state snapshot) completes. This exactly matches "smeared
when I tap in, heals itself" — it isn't new pixel/buffer corruption (rules 28
and 29's mechanisms), it's an **unsignalled recovery window** being
misread as corruption.

**Fix:** wire a new `onProbing(probing: boolean)` callback through
`wsLiveness.ts` → `useTerminalSocket.ts`, firing `true` the instant
`reviveIfStale()` commits to a probe and `false` the moment it resolves
(pong-in-time or close-and-hand-off to `scheduleReconnect`, which sets the
same `reconnecting` state again — a no-op). The existing banner UI needed no
changes; it was already correct, just triggered too late.

## Acceptance Criteria

- **AC-1 — Terminal smear-on-tap.** The "Connection lost — reconnecting…"
  banner appears the instant an eager liveness probe starts (tap/keydown
  after 8s of inbound silence), not only after the probe fails and the socket
  closes. A probe answered in time (pong before the 4s deadline) clears the
  banner without a reconnect. **Accepted trade-off (doubt-review MEDIUM):** a
  probe that resolves in the ~1.5-4s band — an otherwise-healthy connection
  merely slow to pong, plausible on the exact flaky iPad networks this
  iterate targets — now visibly flashes the banner for a bounded window
  where before it was silent (the existing `RECONNECTING_BANNER_GRACE_MS`
  grace timer already suppresses anything under 1.5s, so this reuses that
  threshold rather than inventing a new one). Staying silent instead would
  leave exactly that slow-but-recovering population unsignalled, reintroducing
  the bug for that band. Proven bounded (self-dismisses the instant the pong
  lands, never stuck) by a composed test driving the real probe timer through
  the real grace timer — see `useTerminalShellEffects.reconnecting.test.ts`.
- **AC-2 — Title truncation on tablet.** The existing phone-only (≤767px)
  single-line-truncate + tap-to-expand-popover title pattern now applies
  across the full compact band (≤1023px = tablet + phone), not phone only.
- **AC-3 — Sidebar Settings clipped.** On a short tablet viewport, the nav
  item list scrolls internally when it overflows; the bottom "Settings" item
  (a sibling of the list, not inside it) always stays visible.
- **AC-4 — Terminal header bar on tablet.** The two-row compact header layout
  (already built for phones) applies across the full compact band, and the
  Instruments (Grade/Tests/Serves) chip cluster — previously shown throughout
  the whole 768–1023px tablet band due to a `md:` (768px) vs. the codebase's
  own `useIsCompactViewport` (1023px) breakpoint mismatch — now hides
  consistently with the rest of the compact simplification (`lg:flex`,
  1024px, the boundary that actually matches).
- **AC-4b — Desktop-branch title truncation (found during live-browser
  audit, not in the original report).** The desktop header title had no
  truncation at all and wrapped across as many lines as the title needed,
  eating most of the header's height before the terminal even started. This
  reproduces on the classic iPad / iPad-mini landscape width (1024px CSS
  px), which sits 1px outside the ≤1023px compact breakpoint and so never
  got AC-4's condensed layout — but the underlying defect (an unbounded
  title) is breakpoint-independent and would show on any sufficiently
  narrow real desktop window with a long title too. Fixed at the actual
  root cause: the desktop title now single-line-truncates with a native
  `title` tooltip, matching how every other long-content chip in this header
  already behaves.
- **AC-5 — Triage on tablet.** Investigated (see below); **no reproducible
  defect found**. No code change.
- **AC-6 — Ship's Log independent scroll.** The Project Documents panel
  scrolls independently of the Log column at all viewport widths, including
  the previously-broken ≤900px tablet band where a `position: sticky` hack
  silently degraded to `position: static` (merging Docs into the single page
  scroll). The "Project Documents" `<h2>` is visually hidden (`sr-only`)
  but stays in the accessibility tree.

## Investigation — Triage "not all entries shown on tablet" (AC-5)

Static review: `TriagePage.tsx`'s outer scroller is already a correctly
bounded `flex-1 overflow-y-auto` region (rule 27 compliant);
`PerProjectTriageSection.tsx` is a plain unvirtualized `space-y-2` list with
no `max-height`/`overflow-hidden`/width-conditional hiding.
`client/src/**/*triage*` has zero matches for
`useIsPhoneViewport|useIsCompactViewport|useCoarsePointer|window.innerWidth|matchMedia`
— no viewport-conditional hiding exists anywhere in Triage code.

Live measurement (headless Playwright, real dev stack, `hasTouch: true`) at
desktop 1440×900, iPad-portrait 768×1024, iPad-Pro-11 834×1194, and iPad
-landscape 1024×768: at every width, 2 project sections render, the header
count is consistently `(19)`, and the scroller's `scrollHeight` (2844–3013px)
is always well above its `clientHeight` (676–1102px) with `overflow-y: auto`
confirmed via computed style — every item is in the DOM and the container
genuinely overflows/scrolls at every tested tablet width.

**Disposition:** could not reproduce. Most likely explanations, in order:
(a) the sidebar/header fixes in this same iterate already resolved what the
user was actually seeing (a clipped viewport competing for vertical space);
(b) UX confusion — the list does scroll, but nothing signals that past the
fold; (c) a real-device-only Safari quirk headless Chromium can't replicate.
No code change made without a reproduction; flagged for the user to
re-verify against this build.

## Affected Boundaries

- **No IO/persistence boundary.** Presentation-only + one client-side WS
  liveness-signalling fix (no wire-protocol change — no new message type, no
  server change). `touches_io_boundary` does not apply.
- **`touches_shared_infra`** applies: `SidebarNav.tsx`, `EditableTaskTitle.tsx`,
  and the Mission header components are shared across every route — full
  client test suite run (412 files / 3797 tests, all green) rather than
  `--related`.
- Touched surfaces: sidebar nav rail, task-detail header (`MissionTopRow`,
  `Instruments`, `EditableTaskTitle`), Ship's Log page + CSS, terminal WS
  liveness hooks (`wsLiveness.ts`, `useTerminalSocket.ts`).

## Confidence Calibration

- **Boundaries touched:** presentation/layout + client-side WS
  liveness-signalling. No server diff, no persistence, no auth.
- **Empirical probes run:**
  - **P1 (terminal smear mechanism).** Traced the exact interaction handler
    (`onInteraction` → `reviveIfStale`) that fires on tap; confirmed via
    the existing `wsLiveness.wake.test.ts`/`interaction.test.ts` suite that
    an 8s-stale + tap triggers a probe, and that (pre-fix) `reconnecting`
    stayed `false` for the whole probe window. **Finding:** confirmed gap;
    fixed with `onProbing`; new tests assert `true`-then-`false` around a
    resolved probe (`wsLiveness.interaction.test.ts`) and the same at the
    `useTerminalSocket` level (`useTerminalSocket.refocus.test.ts` AC-7/AC-7b).
  - **P2 (Ship's Log independent scroll, live browser).** Loaded
    `/projects/:id/log` at 768×1024 against the real dev stack; read
    `.sl-main`/`.sl-docs` `getBoundingClientRect`/`scrollHeight`/
    `clientHeight`/computed `overflow-y` (both `auto`, both genuinely
    overflowing), then set `.sl-docs.scrollTop = 200` directly and re-read
    both elements' `scrollTop`. **Finding:** `.sl-docs.scrollTop` moved,
    `.sl-main.scrollTop` stayed `0` — the two regions are independently
    bounded scrollers, not one shared page scroll.
  - **P3 (title truncation + header condense, live browser).** Loaded an
    active task with a long title at 768×1024 (iPad portrait). **Finding:**
    header renders as back-arrow + single-line-ellipsized title + status
    pill on one row, Instruments hidden, terminal gets the remaining height.
  - **P4 (iPad landscape, live browser) — found AC-4b.** Same task at
    1024×768 (classic iPad/iPad-mini landscape). **Finding:** the desktop
    header branch rendered (1024px > 1023px compact cutoff) and the title
    wrapped across 5 full lines before Grade/Tests/Serves/Resume even
    appeared — reproducing the user's literal "not on one line, insane
    amount of space" complaint. Root-caused to a missing `truncate` on the
    desktop title (§AC-4b); re-ran the same probe after the fix — header is
    now a single line, terminal panel gets full height.
  - **P5 (sidebar Settings, live browser).** Loaded `/settings` at
    768×1024. **Finding:** "Settings" visible pinned at the bottom of the
    icon rail.
  - **P6 (Triage, live + static) — see the Investigation section above.**
    No reproduction; no fix; documented rather than silently dropped.
- **Test Completeness Ledger** — principle testable ⇒ tested; 0
  testable-untested:

  | # | Behavior (this diff) | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `onProbing(true)` fires the instant an eager probe is sent | tested | `wsLiveness.interaction.test.ts` (new case); E2E `97-terminal-interaction-revive.spec.ts` (new: banner arms while the probe is in flight, real browser, no close/new attach) |
  | 2 | `onProbing(false)` fires once a pong answers the probe in time | tested | `wsLiveness.interaction.test.ts` (same case); same E2E case above (self-dismisses on a late pong) |
  | 3 | `useTerminalSocket` flips `reconnecting=true` the instant a refocus probe starts (before the probe deadline) | tested | `useTerminalSocket.refocus.test.ts` AC-7 |
  | 4 | A probe answered in time flips `reconnecting` back off without a reconnect | tested | `useTerminalSocket.refocus.test.ts` AC-7b (asserts `FakeWebSocket.instances` stays length 1) |
  | 4b | The accepted trade-off (a probe resolving in the 1.5-4s band visibly, boundedly flashes the banner; one resolving under 1.5s never does) is bounded and self-dismissing, not stuck — found by doubt-review, MEDIUM | tested | `useTerminalShellEffects.reconnecting.test.ts`'s new composed suite, driving the real `attachWsLiveness` probe timer through the real grace timer |
  | 5 | Title truncates + tap-to-expand popover at tablet width (compact, non-phone) | tested | `EditableTaskTitle.mobile.test.tsx` ("tablet (compact but not phone-width)" case); E2E `80-tablet-responsive.spec.ts` (new: long title single-line-truncates + tap opens popover at 820×1180) |
  | 6 | Desktop title single-line-truncates with a native tooltip instead of wrapping unbounded | tested | `EditableTaskTitle.mobile.test.tsx` (new "desktop also single-line truncates" case); E2E `80-tablet-responsive.spec.ts` (new: single-line-truncates + native `title` tooltip at 1280×800 AND at the exact 1024×768 iPad-landscape AC-4b boundary) |
  | 7 | Sidebar nav list scrolls internally; Settings stays pinned outside it | tested | `SidebarNav.test.tsx` (existing suite, re-verified green — no new nav-overflow test added; see Known Residual) |
  | 8 | MissionTopRow condensed header applies at tablet-width (compact, non-phone), not phone-only | tested | `TaskDetailHeader.phone.test.tsx` ("also drops the breadcrumb…tablet-width" case) |
  | 9 | Instruments hides below 1024px (`lg:`) instead of below 768px (`md:`) | untestable (`covered-by-existing-test`) | `Instruments.test.tsx`'s existing suite has no `matchMedia`/width-mock dependency (it renders unconditionally in jsdom, which has no viewport); the Tailwind class change itself has no JS branch to unit-test — verified instead by the live-browser probes P3/P4 (Instruments absent at 768×1024 and 1024×768, both ≤1023px effective) |
  | 10 | Ship's Log `.sl-main`/`.sl-docs` are independently bounded scrollers at ≤900px | tested | `ShipsLogPage.test.tsx` + `shell-scroll-invariant.test.ts` (unit, class-fence) + live-browser P2 + E2E `A16-ships-log.spec.ts` (new: real independent-`scrollTop` proof at 820×700 stacked) |
  | 10b | Same height-bounding holds at desktop widths (>900px, side-by-side grid) — disputed by external review (openai MEDIUM) | tested | live-browser probe at 1440×900: computed `grid-template-rows` resolves to a definite `749.156px`; both columns clamped to it with `overflow-y: auto`; E2E `A16-ships-log.spec.ts` (new: independent-`scrollTop` proof at 1280×700 side-by-side) |
  | 13 | A fresh (inbound-recent) socket + user interaction never arms the reconnecting banner | tested | `wsLiveness.interaction.test.ts` (external-review glm LOW — extended existing case with an `onProbing` assertion) |
  | 11 | "Project Documents" heading is visually hidden but stays in the a11y tree | tested | `ShipsLogDocumentsPanel.test.tsx` (existing `getByRole("heading", ...)` assertion, unmodified — still passes with `sr-only` added) |
  | 12 | Triage tablet display | untestable (`requires-manual-visual-judgment`) | investigated exhaustively (static review + 4-viewport live measurement, §Investigation) but not reproduced; no behavior exists to pin a test to. Flagged for the user to re-check against this build rather than closed silently |

- **Confidence-pattern check:**
  - *Asymptote (depth):* the terminal-smear fix is the highest-stakes item
    (explicitly the user's top priority) and got the deepest treatment —
    root-caused via component-boundary tracing (not guessed), the fix is a
    single well-scoped callback wired through one existing, already-tested
    code path (no new WS message type, no protocol change), and both the
    hook-level and consumer-level behavior are unit-tested around the exact
    timing boundary (before/after the probe deadline).
  - *Coverage (breadth):* every reported item was independently verified —
    5 live-browser probes across 3 distinct real routes (task detail,
    sidebar/settings, Ship's Log) at 2 real iPad resolutions (768×1024
    portrait, 1024×768 landscape), plus the full existing unit suite
    (412 files / 3797 tests, all green) and `tsc --noEmit` clean.
  - *Integration composition:* `cross_component` N/A — no framework
    merge/hook/campaign machinery touched.
  - *Known residual:* AC-4b was found DURING this iterate's own live-browser
    audit, not in the original report — it is documented here rather than
    filed as a separate follow-up because it's the same header component
    and the same root cause class (unbounded title) as AC-2/AC-4. Item #7
    (sidebar) has no NEW automated overflow-scroll test — the existing
    `SidebarNav.test.tsx` suite doesn't simulate a short viewport height,
    so the "Settings visible under overflow" claim rests on live-browser
    probe P5 plus the CSS mechanism (rule 24/27 pattern) rather than a
    height-constrained jsdom test; a follow-up could add one but jsdom has
    no real layout engine to make such a test meaningful without extensive
    mocking. Triage (AC-5) stays open per the Investigation section — not a
    known residual so much as an explicitly undischarged item.
    `client/e2e/flows/80-tablet-responsive.spec.ts` grew to 383 lines adding
    the AC-2/AC-4/AC-4b coverage above, crossing the 300-line convention
    guideline; registered as `grandfathered` in `shipwright_bloat_baseline.json`
    rather than split, since the four describe blocks (compact layout,
    terminal-survives-breakpoint-crossing, desktop non-regression, the exact
    1024px boundary) all assert the same `COMPACT_MEDIA_QUERY` breakpoint
    contract and read as one scenario document.

## External Code Review Findings (Branch A: openai + glm, both `revise`)

| # | Provider | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | openai | MEDIUM | `.ships-log`'s desktop (>900px) side-by-side grid has no explicit `grid-template-rows`, disputing whether it reliably height-bounds `.sl-main`/`.sl-docs` | **False positive — empirically verified.** Live Playwright probe at 1440×900 shows the browser resolves the implicit row to a definite computed `grid-template-rows: 749.156px` (the `align-content: normal → stretch` mechanism, given the container's definite `height: 100%` and both columns' `min-height: 0`), and both columns are clamped to that exact height with `overflow-y: auto` — the same shape already proven at ≤900px (Ledger #10). Matches glm's own "verified-sound" counter-claim. |
| 2 | glm | MEDIUM | `package.json`/lockfile drift | **False positive.** `package.json` was already pinned at 0.27.0 with zero diff on that file; the lockfile change catches up a pre-existing drift, it does not introduce one. |
| 3 | glm | LOW | `ShipsLogPage.tsx`'s non-project states (loading/error) may lose their scroll owner under the new `flex-1 overflow-hidden` wrapper | **False positive.** The "project not found" branch (line 63-79) is a separate early return with its own `<div className="flex-1 overflow-y-auto">` — never nested inside the `{project && (...)}` conditional this iterate changed. The loading state renders no content inside the wrapper (blank until data arrives), so there is nothing to scroll there either. |
| 4 | glm | LOW | Missing negative test: a fresh/non-stale socket + interaction should not fire `onProbing` | **Fixed.** Extended the existing "does NOTHING on a healthy socket" case in `wsLiveness.interaction.test.ts` with `expect(t.onProbing).not.toHaveBeenCalledWith(true)`. |
| 5 | glm | LOW | Audit all consumers of `useTerminalSocket`'s `reconnecting` to confirm only the banner reads it | **Verified sound.** Grepped all production consumers: `TerminalBanners.tsx` only (renders the banner text/testid); `useTerminalShellEffects.ts` only forwards it to `setReconnectingArmed`. Nothing gates input, send paths, or other overlays on it. |
| 6 | glm | LOW | The probe-failure path may rely on synchronous batching (close→scheduleReconnect landing in the same tick as `clearProbe`) to avoid a banner blink | **False positive — safe by construction, not by timing.** `onDisconnected()` does not call `clearProbe()`, so `awaitingProbe`/`onProbing(true)` stays true straight through the close. `scheduleReconnect()` then calls `setReconnecting(true)` again — the *same* value, a no-op re-render, not a blink — until the fresh connection's `onConnected()` clears it. Already documented in `useTerminalSocket.ts`'s `onProbing` wiring comment ("close → scheduleReconnect handoff... sets the same state again, a no-op"). |

Both providers' overall `revise` verdict is resolved: every MEDIUM was a false positive (empirically or diff-verified), every LOW is either fixed or verified sound. No further external-review round required.

## Out of scope (explicit)

- Any change to Triage's rendering — investigated, not reproduced, not
  touched (§AC-5).
- Widening the shared `COMPACT_MEDIA_QUERY` (1023px) constant itself — it is
  deliberately anchored 1px below Tailwind's `lg` (1024px) and has 30
  consumers app-wide; AC-4b's root cause (an unbounded title) was fixed
  directly instead of touching that shared breakpoint, which would have
  re-created the exact `md:`/`lg:` mismatch class this same iterate just
  fixed in `Instruments.tsx` for any consumer still on a bare Tailwind
  breakpoint utility.
- Any backend/server change.
