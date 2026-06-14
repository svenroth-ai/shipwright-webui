# Iterate Spec — Phone Responsive View

- **run_id:** `iterate-2026-06-14-phone-responsive-view`
- **Intent:** FEATURE
- **Complexity:** medium
- **Spec Impact:** ADD (new phone-band responsive behavior; tablet + desktop layouts unchanged)
- **Date:** 2026-06-14
- **Phasing:** Iterate **2 of 2** in the user-agreed device-phased rollout.
  Iterate 1 = **Tablet** (≤1023px, FR-01.38, PR #139, merged `d30d8a7`).
  This iterate = **Phone** (<768px). It REUSES the iterate-1 foundation
  (`useIsCompactViewport`, `PaneTabBar`, the persistent-`PanelGroup`
  terminal-never-unmounts pattern) and does NOT rebuild it.

## Problem

Phones already inherit the tablet **compact** band (`useIsCompactViewport`
fires at ≤1023px, so <768px is compact too: railed sidebar, board swipe
carousel, tabbed task-detail). But six things still break / are unusable below
768px on a real 375–480px phone:

1. **Sidebar.** The compact band collapses the sidebar to a **60px icon
   rail**, but the rail is still inline in the flex flow and the user can
   expand it to **200px** — a 200px push eats a 375px screen, and even the
   60px rail steals ~16% of a phone's width.
2. **Terminal.** The embedded terminal has touch-scroll (ADR-132) but no
   on-screen affordance for the keys a phone soft-keyboard lacks (Esc, Tab,
   arrows, Ctrl-C, Enter) — so Claude's interactive prompts (AskUserQuestion
   menus, Esc-to-cancel, Ctrl-C) are undriveable. User's explicit ask:
   "fully interactive terminal everywhere."
3. **Modals.** The `max-w-[9x vw]` clamps only bite below ~463px (iterate-1
   left this to phone scope).
4. **Tables.** TaskList still shows Phase + Updated columns <768px; the
   Projects table (inline-styled, long Path column) overflows.
5. **Touch targets** under the 44px minimum on the densest controls.
6. **iOS safe-area** — no `viewport-fit=cover`; notch / home-indicator can
   occlude a fixed drawer / key bar.

## Goal

Make the WebUI genuinely usable on phones (375–480px) **without changing the
tablet (768–1023px) or desktop (≥1024px) layouts**, reusing the iterate-1
breakpoint + compact-layout foundation.

## Breakpoint contract (extends iterate-1)

| Band | Range | Sidebar | Terminal keys | Source of truth |
|---|---|---|---|---|
| **Desktop** | ≥1024px | 200px expanded (unchanged) | physical kbd | — |
| **Tablet** | 768–1023px | 60px rail (unchanged) | physical kbd / bar if touch | `useIsCompactViewport` |
| **Phone** | <768px | **overlay drawer** (NEW) | on-screen key bar | `useIsPhoneViewport` (NEW) |

The new phone SSoT is `useIsPhoneViewport()` wrapping
`matchMedia('(max-width: 767px)')` — added ALONGSIDE `useIsCompactViewport`
in the same file, sharing its SSR-safe / reactive pattern. It does NOT fork
the compact threshold (plan-review M2 from iterate-1). The terminal key bar
gates on `(pointer: coarse)` (touch ⇒ likely no hardware keyboard) so it is
correct "everywhere" a touch device is used, not just at a width.

## Acceptance Criteria

- **AC-1 — Phone breakpoint foundation.** `useIsPhoneViewport()` +
  `PHONE_MEDIA_QUERY = '(max-width: 767px)'` exist in
  `client/src/hooks/useIsCompactViewport.ts` (matchMedia, SSR-safe,
  change-listener) as the single JS SSoT for the phone band. Tablet + desktop
  render byte-identical to today (no compact-threshold change).

- **AC-2 — Sidebar overlay drawer (<768px).** At phone width the sidebar
  leaves the inline flex flow and presents as an off-canvas **overlay drawer**
  (hidden by default; slides in ~260px with full labels when open), opened by
  a **phone-only top app bar** hamburger and closed by: tapping a nav item,
  tapping the scrim, or `Escape`. Content gets the full viewport width (no
  60px rail, no 200px push). The drawer auto-closes on route change. Tablet
  keeps the 60px rail; desktop keeps the 200px expanded sidebar — both
  byte-identical to today (drawer code is `useIsPhoneViewport`-gated).

- **AC-3 — Fully-interactive terminal on touch.** On a coarse-pointer device
  AND when the connection is the **writer**, the embedded terminal renders an
  on-screen key accessory bar — **⌨ (summon keyboard) · Esc · Tab · Ctrl-C ·
  ↑ ↓ ← → · Enter** — that writes the exact control sequences to the pty over
  the SAME `socket.send({ type:"data", payload })` writer path `term.onData`
  uses (NO new server surface; ADR-067/068-A1 unchanged; not the
  `actions.json` path), refocusing the terminal after each press so the soft
  keyboard stays up. The bar is hidden for the read-only reader role and on
  fine-pointer desktop. Tapping the terminal focuses xterm's textarea so the
  OS soft keyboard appears for free-text. The terminal subtree still NEVER
  unmounts across a breakpoint crossing (CLAUDE.md rule 21 preserved — the
  key bar is a sibling of the canvas inside the same persistent mount).

- **AC-4 — Modals fit phones (375–480px).** EditTaskModal,
  ContinuePipelineModal, the NewIssue/wizard `ModalShell`, and
  TriageDetailModal fit a 375px viewport with no horizontal page overflow
  (existing `max-w` clamps bite; bodies already scroll vertically); their
  footer action rows wrap and primary buttons meet the 44px touch target.
  Verification-led — only minimal className tweaks (these are bloat-ceiling
  files: EditTaskModal 439 / ContinuePipelineModal 321 / TriageDetailModal
  375, all net-zero; ModalShell 183 free).

- **AC-5 — List + Projects tables usable on phone.** At <768px `TaskList`
  hides the non-essential **Phase** column (net-zero `md:`-gating) and the
  table card scrolls horizontally (`overflow-x-auto`) instead of widening the
  page; the **Projects** table likewise scrolls horizontally within its card.
  No horizontal page overflow at 390px on `/` (list view) or `/projects`.
  `TaskList` (534) + `ProjectsPage` (439) stay net-zero (className /
  single-style-prop swaps). **Scope note (code-review MEDIUM-1):** the
  *Updated* column is NOT `md:`-gated — its header is the shared `SortableTh`
  component (hardcoded className, also used by the always-visible *Title*
  column), so column-gating it would require a `SortableTh` signature change
  that adds a line to the frozen 534-LOC `TaskList` (a bloat-baseline ratchet
  the pre-commit hook blocks). Hiding Phase + the `overflow-x-auto` card
  already deliver the hard requirement (no page overflow at 390px, E2E-proven);
  the narrow `Updated` timestamp column stays. (Mirrors the iterate-1 H3
  decision to scope list-view changes to what is net-zero-safe.)

- **AC-6 — Touch targets + iOS safe-area.** New/primary phone touch surfaces
  (drawer hamburger, drawer nav items, terminal key-bar buttons) are ≥44px.
  `index.html` gains `viewport-fit=cover`; the phone top bar, drawer, and
  terminal key bar pad against `env(safe-area-inset-*)` so notch /
  home-indicator areas don't occlude controls.

## Mini-Plan (chosen approach)

Reuse iterate-1; branch on the NEW phone query only where the tablet compact
band is insufficient; keep bloat-ceiling files at net-zero (className /
single-prop swaps); put all new logic in small/new free files.

1. **Foundation** — extend `client/src/hooks/useIsCompactViewport.ts`:
   add `PHONE_MEDIA_QUERY` + `useIsPhoneViewport()` (free file, +~20 LOC).
2. **Sidebar drawer** — `MainLayout.tsx` (21 LOC, free) owns `drawerOpen` +
   `isPhone`, renders a phone-only top bar (hamburger + brand, `md:hidden`),
   a scrim, and an Escape/route-change close. `SidebarNav.tsx` (127, free)
   gains optional `drawer` / `open` / `onNavigate` props: in drawer mode the
   `<aside>` is `fixed` + transform-slide (off the flex flow), full labels,
   nav-item tap → `onNavigate` (close). `SidebarNavItem` gains an optional
   `onSelect`. Non-drawer (tablet/desktop) path is the current code verbatim.
3. **Terminal key bar** — new free file
   `client/src/components/terminal/TerminalKeyBar.tsx`: presentational
   coarse-pointer-gated accessory bar; props `onKey(seq)`, `onFocusTerm()`,
   `role`. Sends control sequences via the parent's `socket.send` data-frame.
   `EmbeddedTerminal.tsx` renders it as a `shrink-0` sibling below the canvas
   (minimal wiring; the component owns socket + termRef.focus).
4. **Modals** — verify fit; add footer-row `flex-wrap` + 44px primary-button
   min-height where missing (single-class edits on ceiling files).
5. **Tables** — `TaskList`: `md:table-cell`-gate Phase + Updated `<th>`/`<td>`
   (net-zero). `ProjectsPage`: wrapper `overflow:'hidden'` → `overflowX:'auto'`
   (single-prop, net-zero) so the table scrolls in-card.
6. **Safe-area + touch** — `index.html` `viewport-fit=cover`; `index.css`
   (not bloat-tracked) safe-area + 44px touch utilities used by the new
   surfaces.

### Alternatives considered (Think-Before-Coding)

- **Reuse the 60px rail on phone (no drawer).** Rejected: 60px on 375px is
  16% lost width and the user can still expand to 200px (the stated problem).
  An off-canvas drawer gives content the full width and is the platform-idiom.
- **A separate phone-only Sidebar component.** Rejected (DRY / YAGNI):
  duplicates the nav list + badge wiring; drift risk. Drawer mode as a prop
  on the existing `SidebarNav` keeps ONE nav definition.
- **Render the key bar in `TaskDetailPage` via an extended ref handle.**
  Rejected: `TaskDetailPage` (676) is a bloat-baseline file (ratchet-blocked);
  the key bar belongs with the socket it writes to anyway. Render inside
  `EmbeddedTerminal` (the socket owner) instead.
- **Make the soft keyboard the sole input (no key bar).** Rejected: phone
  soft-keyboards have no Esc/Tab/arrows/Ctrl — Claude's interactive menus
  would be undriveable. The bar is the load-bearing part of "fully
  interactive."

### Plan review (2026-06-14)

External-review keys (OPENAI/GEMINI/GOOGLE) absent → external LLM plan review
**degraded**; substitute the internal `opus-plan-reviewer` agent (Branch-C
fallback; recorded in `degraded[]`). Verdict **REWORK**; all findings adopted:

- **C1 (adopted)** — the existing Playwright configs use only `Desktop Chrome`
  (fine-pointer, no touch); `(pointer:coarse)` would resolve **false** and a
  phone E2E would pass for the wrong reason. Add a `mobile-chromium` project
  (`devices['Pixel 7']` → `hasTouch + isMobile + viewport`) and **assert
  `matchMedia('(pointer:coarse)').matches === true` first**, before asserting
  key-bar visibility, so the gate itself is proven.
- **C2 (adopted/verified)** — `TaskList` empty-state `<td colSpan={6}>` already
  *over*-spans today (the Commit col is `lg:table-cell`-hidden at <1024 → 5
  visible vs colSpan 6) and renders fine (browsers clamp an over-span). Hiding
  Phase+Updated keeps colSpan=6 over-spanning → no JS/LOC change; verified
  empirically at F0.5. Net-zero holds.
- **H1 (adopted)** — build the phone drawer on **`@radix-ui/react-dialog`**
  (already the repo's modal primitive: `ModalShell`, `ConfirmDeleteDialog`),
  NOT a hand-rolled `fixed` aside. Free focus-trap, scroll-lock, Escape, scrim,
  focus-restore. `SidebarNav`'s nav body is reused verbatim as Dialog children
  (one nav definition — DRY rationale preserved).
- **H2 (adopted)** — in drawer mode force `collapsed=false` (full labels);
  `useMediaCollapse` (≤1023) must not leak the 60px-rail `sr-only` labels into
  the ≤767 drawer. Unit-assert full labels at 390px.
- **H3 (adopted)** — arrow sequences are **mode-aware**: read
  `term.modes.applicationCursorKeysMode` and emit SS3 (`\x1bOA…`) in
  application-cursor mode (Claude's alt-screen TUI) vs CSI (`\x1b[A…`)
  otherwise. The byte-mapping lives in `EmbeddedTerminal` (where the term +
  mode live); `TerminalKeyBar` emits **semantic key ids** only. Key-bar
  buttons `preventDefault()` on pointer-down so they **never take focus** —
  xterm's textarea keeps focus and the soft keyboard never drops (drop the
  fragile "refocus after each press"). The dedicated **⌨** button is the only
  one that calls `term.focus()` (summon keyboard within the user gesture).
- **H4 (adopted)** — `onKey` re-checks `socket.role === "writer"` at send time
  (mirrors `useAutoLaunch`), not just visibility; reader role → no-op. Bar
  **visibility/height is gated on `(pointer:coarse)` only (stable)**;
  interactivity (enabled) gated on writer — so a reader↔writer promotion never
  mounts/unmounts the bar and never resizes the pty (M4).
- **M1 (adopted/verified)** — `ProjectsPage` Path col is `nowrap` capped 400px
  → the table's natural width exceeds 390px, so `overflow:'hidden'` →
  `overflowX:'auto'` (single style-prop, net-zero) DOES scroll. Square
  bottom-corner on the scroll edge accepted (cosmetic). Verified at F0.5.
- **M2 (adopted)** — register `TerminalKeyBar` + `useIsPhoneViewport` in
  `doc-sync.test.ts REQUIRED_TOKENS` + add to `component_inventory.md` /
  `architecture.md` (CLAUDE.md guard #11) at F1/F2.
- **M3 (adopted)** — use **`dvh`** for the phone shell + drawer (not `vh`), and
  add **`interactive-widget=resizes-content`** to the viewport meta so the soft
  keyboard *resizes* the layout (key bar + input line stay above it) instead of
  overlaying. iOS Safari `interactive-widget` support is partial → named
  residual; `dvh` + `viewport-fit=cover` are the cross-browser floor.
- **L1 (adopted)** — the phone top bar shows the **logo SVG only (no
  "Shipwright" text)** so it can't duplicate the brand string / break
  `getByText`.
- **L2 (adopted)** — `useIsPhoneViewport` copies the effect-time re-sync line
  verbatim (first-paint flash guard).
- **L3 (adopted)** — phone E2E asserts at 768px AND 1024px that the inline
  sidebar (not the drawer / top bar) renders — an up-band leak guard.
- **Extra (adopted)** — `overscroll-behavior: contain` on scroll containers
  (pull-to-refresh guard); top bar `shrink-0` minimal height (vertical
  budget). The soft-keyboard-covers-content problem is solved by
  `interactive-widget=resizes-content` + `dvh` (above).

## Affected Boundaries

- **None at the IO/persistence boundary.** Presentation-only: no API routes,
  no store mutations, no message contracts, no config schemas, **no server
  diff**. The terminal key bar writes via the EXISTING `socket.send` data
  frame (ADR-068-A1) — same path `term.onData` already uses; no new protocol.
  `touches_io_boundary` does NOT apply. Backend-affects-Frontend rule N/A.
- Touched UI surfaces: app shell / sidebar (drawer), embedded terminal (key
  bar), modals, list + projects tables, global CSS, index.html.

## Confidence Calibration

- **Boundaries touched:** Presentation/layout only. No IO, persistence, auth,
  migrations, public API, or server code.
- **Empirical probes run** (full client unit suite **1647/1647**; `tsc --noEmit`
  exit 0; production build exit 0):
  - **P1 — touch harness is real (plan-review C1).** New Playwright
    `mobile-chromium` project (`devices['Pixel 5']`, 393px, hasTouch+isMobile).
    Spec 90 test 1 asserts `matchMedia('(pointer:coarse)').matches === true`
    AND `matchMedia('(max-width:767px)').matches === true` BEFORE any gated
    assertion. **Finding: PASS** — the gate is proven, not assumed.
  - **P2 — no horizontal page overflow.** `documentElement.scrollWidth ≤
    clientWidth+1` at 393px on `/ · /projects · /inbox · /triage · /settings
    · /diagnostics`, list view, and with the create wizard open. **PASS.**
  - **P3 — sidebar drawer.** Real browser: top-bar hamburger present, inline
    sidebar absent; tap opens the Radix drawer (full labels, `min-height ≥
    44px` computed); Escape + nav-tap close it; nav-tap navigates. **PASS.**
  - **P4 — terminal key bar (AC-3).** On the touch stack the bar renders with
    all keys (Esc/Tab/Ctrl-C/arrows/Enter/⌨). Unit: `terminalKeySequence`
    CSI-vs-SS3 mapping; `EmbeddedTerminal` writer→`socket.send("\x1b")` on
    Esc tap, reader→disabled+no send. **PASS.**
  - **P5 — desktop/tablet non-regression.** The pre-existing tablet spec 80
    (17/17) re-run green under the desktop `chromium` project after the
    `SidebarNav`/`MainLayout` refactor; spec 90 up-band guard asserts the
    inline sidebar (not the drawer) at 1024px. **PASS.**
- **Test Completeness Ledger** — principle testable ⇒ tested; 0 testable-untested:

  | # | Behavior (this diff) | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `useIsPhoneViewport` ≤767 reactive, SSR-safe, distinct from compact | tested | `useIsCompactViewport.test.ts` (phone block, 5) |
  | 2 | `useCoarsePointer` gates on `(pointer:coarse)` | tested | `TerminalKeyBar.test.tsx` (renders null on fine / bar on coarse) |
  | 3 | Phone sidebar = overlay drawer; inline sidebar absent <768 | tested | `MainLayout.test.tsx` (phone) + E2E P3 |
  | 4 | Drawer opens on hamburger; closes on Escape + nav-tap; nav navigates | tested | `MainLayout.test.tsx` (open) + E2E P3 (Escape/nav-tap/URL) |
  | 5 | Drawer shows FULL labels (not the rail) even when compact (H2) | tested | `SidebarNav.test.tsx` (H2) + E2E P3 |
  | 6 | Up-band guard: ≥768 renders inline sidebar, no drawer/top-bar (L3) | tested | `MainLayout.test.tsx` (desktop) + E2E P5 |
  | 7 | `terminalKeySequence` Esc/Tab/Ctrl-C/Enter + CSI/SS3 arrows | tested | `TerminalKeyBar.test.tsx` (8) |
  | 8 | Key bar renders on coarse / null on fine; all keys present | tested | `TerminalKeyBar.test.tsx` + E2E P4 |
  | 9 | Key-bar buttons preventDefault (no focus steal); ⌨ focuses term | tested | `TerminalKeyBar.test.tsx` (pointerdown defaultPrevented + ⌨→onFocusTerminal) |
  | 10 | Key bar writes the mapped byte to the pty (writer); reader disabled, no write (H4) | tested | composition: `terminalKeySequence` unit (id->byte CSI/SS3) + `TerminalKeyBar.test` (reader->disabled, no onKey) + `EmbeddedTerminal.test` onData->`socket.send` (writer-frame path) + E2E P4 (bar enabled on touch); `EmbeddedTerminal` onKey re-checks `role==="writer"`. Direct EmbeddedTerminal-onKey assertion deferred (would ratchet the baseline-locked `EmbeddedTerminal.test.tsx` 2202). |
  | 11 | Terminal subtree never unmounts (key bar is a sibling of the persistent canvas) | tested | `EmbeddedTerminal.test.tsx` (70) + spec 80 P1b (same node across crossing) |
  | 12 | List: Phase column hidden <md, shown ≥md; no page overflow at 393 | tested | E2E (`task-list-header-phase` hidden@393) + spec 80 (visible ≥lg path intact) |
  | 13 | Projects table scrolls in-card; no page overflow at 393 | tested | E2E P2 (`/projects` no overflow) |
  | 14 | Modal fits 393px viewport; footer wraps; primary 44px on touch | tested | E2E P2 (wizard width ≤ vw, no overflow) + modal unit suites (41) |
  | 15 | Touch targets ≥44px on new surfaces (nav/keys/hamburger) | tested | E2E P3 (computed `min-height ≥ 44`) + `h-11` key/hamburger |
  | 16 | `viewport-fit=cover` + `interactive-widget=resizes-content`; dvh shell; safe-area pads | untestable (`requires-physical-device`) | meta/CSS present + build-compiled (`100dvh`, `env(safe-area-inset-*)`); the soft-keyboard-resize + notch-inset effect needs a real iOS/Android device — no headless harness |
  | 17 | `useIsCompactViewport` public behavior unchanged after the shared-`useMediaQuery` refactor | tested | existing `useIsCompactViewport.test.ts` (compact block) + SidebarNav rail tests + spec 80 |

  - **Enumeration basis:** every behavior introduced/changed by the 6 ACs +
    the foundation refactor; 17 rows, 16 `tested`, 1 `untestable`
    (`requires-physical-device`), 0 testable-untested.
- **Confidence-pattern check:**
  - *Asymptote (depth):* the load-bearing risks were each probed
    independently — the touch gate is proven before its effects (C1); the
    key-bar→pty write is unit-tested at the integration glue (writer sends,
    reader blocked) AND the mapping is exhaustively unit-tested AND the bar is
    E2E-visible on a real touch browser; the terminal-never-unmounts invariant
    is held by construction (sibling-of-persistent-canvas) + verified by spec
    80's same-node-across-crossing probe. The code review caught the AC-5
    Phase/Updated divergence (now spec-amended) and prompted the 44px
    computed-style E2E proof.
  - *Coverage (breadth):* all 6 daily-driver routes + drawer + key bar + list
    + projects + a modal, at 393px (touch) AND 1024px (up-band guard), plus
    full desktop/tablet non-regression (spec 80, 17/17).
  - *Integration composition:* `cross_component` N/A — presentation-only.
  - *Known residual (named):* iOS Safari `interactive-widget` support is
    partial (Chrome Android is the floor); the safe-area/keyboard-resize
    visual effect is `requires-physical-device` (row 16). The discrete `Ctrl`
    sticky-modifier and arrow-key roving-tabindex remain out of scope.

## Out of scope (explicit)

- Tablet (768–1023px) + desktop (≥1024px) layouts — unchanged this iterate.
- Structural file splits of `TaskBoardPage` / `TaskDetailPage` / `TaskList`.
- Any backend/server change.
- A sticky-Ctrl modifier that intercepts soft-keyboard letters (the discrete
  Ctrl-C button covers the interactive need; a general sticky modifier can't
  see soft-keyboard input and is its own iterate if ever wanted).
- Landscape-phone modal vertical fit at extreme short heights (bodies already
  scroll; portrait is the target).

## Reflection (F3a)

- **The plan review pre-empted a falsely-green E2E.** The biggest catch was
  C1: the existing Playwright config only had a fine-pointer `Desktop Chrome`
  project, so a `(pointer:coarse)`-gated assertion would have *passed by
  being absent* — proving nothing. Adding a `mobile-chromium` (Pixel 5) project
  AND asserting the media gate is true *before* its effects converted a
  plausible-but-hollow test into a real one. Reusable rule: when a feature is
  gated on a media/capability query, the E2E must first prove the harness
  actually satisfies that query.
- **The code review caught a spec↔impl divergence the tests masked.** AC-5
  said "hide Phase + Updated"; only Phase was hideable net-zero (the *Updated*
  header is the shared `SortableTh`, and column-gating it would ratchet the
  frozen 534-LOC `TaskList`). The E2E had been written to the implementation,
  so it was green while diverging from the AC. Resolution was to amend the AC
  + document the bloat-ceiling reason — honest scope, not a silent gap.
- **Reusable primitive — drawer = Radix Dialog, not a hand-rolled aside.**
  The plan-review H1 swap to `@radix-ui/react-dialog` for the phone drawer got
  focus-trap, scroll-lock, Escape, scrim, and focus-restore *for free* and
  kept ONE `SidebarNav` nav definition (drawer mode shares the body). Hand-
  rolling a `fixed` overlay would have re-implemented a focus trap badly.
- **Mode-aware terminal keys + no-focus-steal were the load-bearing terminal
  details.** Arrows must switch CSI↔SS3 on `term.modes.applicationCursorKeysMode`
  (Claude's alt-screen TUI uses application-cursor mode), and the key buttons
  must `preventDefault` on pointer-down so they never take focus from xterm's
  textarea — otherwise the soft keyboard drops on every tap. Both came from the
  plan review (H3) and would have been easy to get subtly wrong.
- **`interactive-widget=resizes-content` is the cheap fix for the hardest
  problem.** The "soft keyboard covers the input line" issue — the single
  biggest "phone terminal is unusable" failure mode — is solved by one
  viewport-meta token (+ `dvh`), not a visualViewport-resize hook. Named iOS
  partial-support as a residual rather than over-engineering.
- **Bloat-ceiling discipline again shaped the design for the better:** the key
  bar + its pure mapper + the phone hooks all landed in small/new free files;
  ceiling files took only className/style-prop swaps. The one accepted crossing
  (`EmbeddedTerminal` 300→311) is a delegating shell gaining a 9th child for
  the user's explicit core ask ("fully interactive terminal everywhere") — a
  non-baseline file, so advisory-only, and recorded here.
- **Deferred (future):** a sticky-`Ctrl` modifier that intercepts soft-keyboard
  letters (can't see soft-keyboard input — its own iterate); `PaneTabBar`
  arrow-key roving-tabindex (carried over from iterate 1); a real-device pass
  for the safe-area/keyboard-resize visual (row 16, `requires-physical-device`).
