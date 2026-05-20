# Iterate Spec: v0.9.2-embedded-terminal-mount-races

- **Run ID:** iterate-2026-05-11-v0-9-2-embedded-terminal-mount-races
- **Type:** bug
- **Complexity:** medium
- **Status:** draft
- **ADR slot:** ADR-084

## Goal

Fix two real-browser regressions surfaced after v0.9.1 (ADR-083) opened the WS upgrade gate for Tailscale: (1) a transient "Read only" banner flash when EmbeddedTerminal mounts under React.StrictMode dev double-mount because the second WS gets `role=reader` until the first WS's onClose drives `writer-promoted`; (2) an uncaught `Cannot read properties of undefined (reading 'dimensions')` pageerror from xterm-addon-fit accessing `_renderService.dimensions` after `term.dispose()` (or before `term.open()` finishes setting it up) via an async tail that escapes the existing try/catch frames around `fit.fit()`. Both bugs were invisible pre-v0.9.1 because the WS upgrade returned 500 before replay/render reached the client.

## Acceptance Criteria

### AC-1 — No transient "Read only" banner on a clean fresh mount (writer/reader race fix)

- [ ] Given a real browser navigates to `/tasks/<id>` for a task with no other tabs open and no stale writer, when EmbeddedTerminal mounts under React.StrictMode dev double-mount (or under a similar mount/cleanup/remount cycle), then the visible `embedded-terminal-readonly` banner MUST NOT render during the first 1500 ms after a fresh `ready` envelope, even if the underlying socket role transiently equals `"reader"` while the StrictMode mount-1 WS close is in flight and before `writer-promoted` arrives.
- [ ] Given the role TRULY stabilizes at `"reader"` (a second real tab is open holding the writer), when the grace window elapses, then the banner DOES render and stays rendered until the role flips to `"writer"` via a `writer-promoted` envelope.
- [ ] Given `writer-promoted` arrives at any point, when the client processes the envelope, then `socket.role` flips to `"writer"` synchronously, the banner hides without flicker, and any pending grace timer is cancelled (no banner re-appearance after promotion).
- [ ] **Grace timer connection-scoping (per external plan review openai #2 + #3 / gemini #1):** the grace window's start timestamp MUST be re-anchored on every fresh `ready` envelope arrival (not just on `taskId` change). A WS reconnect on the same task (e.g. server restart, network blip) re-anchors so a legitimate `reader` role from a real second-tab scenario re-arms cleanly after the grace window. Implementation: a single `useEffect` keyed on `[socket.ready, socket.role]` captures `startTime = Date.now()` inside its closure when `socket.ready` flips false→true, schedules the arm-timer with `setTimeout(..., GRACE_MS)`, returns a cleanup that `clearTimeout`s on every dep change so the new effect-instance always owns its own timer. No cross-effect ordering hazard (only one effect manages the grace state).
- [ ] **Input behavior decoupled from banner visibility (per external plan review openai #9):** the actual data-send / read-only handling stays tied to `socket.role`, NOT to the banner-visible state. During the grace window the banner is hidden BUT the client still sends data envelopes to the server; the server's role gate at `server/src/terminal/routes.ts:onMessage` decides whether to deliver to pty or reply `read_only`. The grace fix is purely a visual debounce.
- [ ] Server-side: the WS upgrade handler at `server/src/terminal/routes.ts:onOpen` MUST keep emitting `writer-promoted` on writer-slot vacate (this contract already exists via `onPromoteToWriter` → `entry.connSubs` ordering, and MUST stay green on existing tests `server/src/terminal/pty-manager.test.ts` writer-promotion suite).

### AC-2 — Bulletproof xterm against dispose + pre-ready renderer (dimensions pageerror fix)

**Empirical root-cause update (post-Stage 2 F0.5 run):** The initial spec hypothesis was that the dimensions pageerror surfaced from one of OUR `fit.fit()` call sites via an async tail. F0.5 with stack trace capture revealed the real source — `Viewport.syncScrollArea` inside xterm.js itself (`@xterm/xterm.js:1885:41 get dimensions; 831:70 Viewport.syncScrollArea; 808:1507`), called from xterm's own queued RAF / scroll listeners after `term.dispose()` nulled the underlying renderer. The `safeFit + disposedRef` chain (still landed) is necessary but not sufficient — xterm's INTERNAL async tail doesn't route through our wrappers.

Additional fix: **pre-emptively stub `_renderService.dimensions` with safe zero-dim shapes BEFORE `term.dispose()`** so straggler `Viewport.syncScrollArea` / `Renderer.refresh` callbacks compute against zero dims (harmless no-op) instead of throwing. The stub is bounded to cleanup-time on the about-to-be-torn-down component instance; future xterm refactors that rename `_core` / `_renderService` cause `Object.defineProperty` to no-op via the wrapping try/catch instead of permanently disabling resize.


- [ ] Given EmbeddedTerminal mounts and immediately unmounts under React.StrictMode dev double-mount, when any subsequent async tail of a `fit.fit()` call would access `term._core._renderService.dimensions` on the disposed-mount-1 instance, then NO uncaught `Cannot read properties of undefined (reading 'dimensions')` pageerror reaches `window.onerror` / Playwright `page.on("pageerror")`. The fix is structural: a `disposedRef` set in cleanup BEFORE `term.dispose()` plus a pre-fit `_renderService` existence probe shortcircuits the FitAddon path before it dereferences the nulled renderer.
- [ ] Given xterm's renderer is not yet initialized (e.g. immediately after `new Terminal()` before `term.open()` returns) OR `_renderService.dimensions` returns zero cell width/height for any reason, when our `fit.fit()` wrappers run, then they MUST early-return without surfacing an error. Existing try/catch frames stay in place as defense-in-depth.
- [ ] All three `fit.fit()` source positions in `client/src/components/terminal/EmbeddedTerminal.tsx` (initial mount L635, `resizeAndSend` body L666 — reachable via both the direct ResizeObserver callback AND the throttled setTimeout path, active-tab effect L720) MUST route through a single `safeFit(fit, term, disposed)` helper that checks `disposed === false`, `term._core?._renderService?.dimensions` is defined AND has non-zero `css.cell.width / height` (per FitAddon source code), before invoking `fit.fit()`. Helper returns `boolean` (true = fit ran, false = skipped) so callers know whether to send a `resize` WS frame. Helper accepts `disposed` as a plain boolean (caller passes `disposedRef.current`), never a literal `false`. Brittleness guard against future xterm refactors: if `_core` or `_renderService` is missing entirely (vs. dimensions being undefined on a present renderer), `safeFit` falls THROUGH to the wrapping try/catch so the path keeps working — only "renderer present but dimensions not yet ready / disposed" short-circuits.
- [ ] Cleanup ordering: in the mount-effect cleanup function the order MUST be (1) `disposedRef.current = true` FIRST, (2) `ro.disconnect()`, (3) `clearTimeout(lastResizePendingRef.current)`, (4) `onDataDispose.dispose()`, (5) `term.dispose()`, (6) `termRef.current = null` etc. This ordering is asserted in the safety model: any straggler async tail (ResizeObserver microtask, RAF callback, scheduled setTimeout) that wins the race against the rest of cleanup is short-circuited by step (1) before it can dereference a nulled `_renderService`.

### AC-3 — Real-browser F0.5 regression spec replaces the diagnostic debug spec

- [ ] A new Playwright spec at `client/e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts` (NOT underscore-prefixed) runs against the live Tailscale dev stack via `playwright.tailscale.config.ts` (or an extended config sharing the baseURL helper). It asserts both AC-1 and AC-2 empirically against the real running server + real browser.
- [ ] The spec captures `page.on("pageerror")` for the entire navigate-to-resume-click cycle and FAILS if ANY pageerror containing `"dimensions"` or `"_renderService"` fires. (Strict-fail; no warning-only.)
- [ ] **The spec asserts banner absence via polling-sample, not single `.toBeHidden({timeout:1400})` (per external plan review openai #8):** sample `embedded-terminal-readonly` visibility every 100 ms across the 1500 ms grace window via `page.evaluate(() => document.querySelector('[data-testid="embedded-terminal-readonly"]') === null)` polled in a Playwright wait-loop. Assert ALL samples returned true (banner-absent). A single `toBeHidden` could miss a transient flash; polling proves continuous absence.
- [ ] For the OPPOSITE direction — verifying the banner DOES render when reader role is truly stable past the grace window — extend the existing `server/src/terminal/pty-manager.test.ts` writer-promoted suite (per external plan review openai #10) rather than introducing a new server-side test file. The added test cases assert (a) `attach()` produces `role: "reader"` for a second connection while a first one holds writer, (b) `detach(firstConn)` triggers `onPromoteToWriter` on the second-connection subscription. No new server file.
- [ ] The diagnostic spec `client/e2e/flows/_v091-debug-resume.spec.ts` is DELETED at finalization — its WS-frame-capture pattern is preserved verbatim in the new regression spec so future debug runs can reuse it.

## Affected FRs

- **FR-01.28** (Embedded terminal — pty + WebSocket bidi + disk-backed scrollback): two new acceptance criteria appended (one per AC-1 + AC-2). The existing `Given the WS opens, then the client receives a {type:"ready"} envelope` AC remains unchanged. The new ACs are about the EmbeddedTerminal CLIENT-side handling of the ready/role flip and the xterm fit() lifecycle.

## Out of Scope

- The user's reported Bug 1 wording mentioned "Vor-v0.9.1-Tab der den Phantom-Writer hält". That scenario (stale-writer-held-by-other-tab) is genuinely covered by the existing `writer-promoted` envelope contract; we do NOT change server-side writer-promotion logic. The fix is purely client-side banner-grace.
- VITE_HOST stale-env handling — explicitly named out-of-scope in the user prompt.
- ConPTY resize redraw / scrollback accumulation — unrelated to mount races; covered by ADR-076a + ADR-077.
- Server-side per-request `tailscale ip -4` subprocess overhead — addressed by ADR-083.

## Design Notes

- No UI design change. The readOnly banner copy + position stays exactly as v0.8.5 AC-1 wired it (header strip on the dark frame, `data-testid="embedded-terminal-readonly"`).
- No new envelope types — `writer-promoted` already exists; only the client-side rendering of `readOnly` gets the 1500 ms grace gate.

## Affected Boundaries

The diff touches WebSocket envelope handling (client) and xterm.js renderer access (client), plus a Playwright regression spec. None of these are user-edited serialized formats. The risk flag `touches_io_boundary` does NOT fire.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a — no new serialized format introduced |

Justification: `writer-promoted` envelope already exists and is unchanged; new `disposedRef` is in-memory React state. Round-trip Boundary Probe step skipped per Override Class "Advisory at small without `touches_io_boundary`".

## Confidence Calibration

(Filled before F0 Fresh Verification Gate — mandatory at medium+.)

- **Boundaries touched:** none new (see Affected Boundaries table). No producer/consumer pair to round-trip.
- **Empirical probes run:**
  - **P1 (real-browser Tailscale repro):** `cd client && npx playwright test e2e/flows/_v091-debug-resume.spec.ts` against live Hono+Vite stack with HONO_HOST=true + VITE_HOST=true. Captured: 2 WS connections on `/api/terminal/<id>/ws` (WS-A 0 frames, WS-B `role=writer` 14 frames) + 1 Vite HMR WS; pageerror `Cannot read properties of undefined (reading 'dimensions')` fired during page load BEFORE Resume click; xterm rendered 1191 chars of Claude TUI content (visually intact in screenshot at `client/test-results/_debug-resume/01-after-load.png`).
  - **P2 (FitAddon source inspection):** `client/node_modules/@xterm/addon-fit/lib/addon-fit.js` confirms `proposeDimensions()` calls `e._renderService.dimensions` with NO null-check, throwing `TypeError` if `_renderService` is undefined. Two access sites: `proposeDimensions()` then `_renderService.clear()`. Both are synchronous within `fit()` body — so the uncaught surface MUST be either (a) the call site's try/catch frame is somehow bypassed by a microtask/RAF tail, or (b) a different code path accesses `_renderService` (more likely — xterm's own RAF rendering pipeline triggered by `term.write()` after dispose).
  - **P3 (FR-01.28 spec AC scan):** confirmed no existing AC names the readOnly-banner-grace behavior; AC-1 + AC-2 are genuinely new.
- **Edge cases NOT probed + why acceptable:**
  - Multi-real-tab race (two browser tabs on same task) — manual UAT path; AC-1 server-side promotion contract already covered by existing unit tests in `pty-manager.test.ts`. Adding a Playwright multi-context test is gold-plating for v0.9.2 given the architectural assertion is unchanged.
  - Server SIGINT mid-mount — out of scope (Iterate 7 covered shutdown semantics; mount races converge to those paths but don't extend them).
- **Confidence-pattern check:** none — this is the first pass; if any "are you confident?" Q gets a yes-with-later-finding, run one more probe before F0.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `cd client && npx playwright test e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts --config=playwright.tailscale.config.ts --reporter=list`
- **Evidence path:** `client/playwright-report-tailscale/` (HTML report) + `.shipwright/runs/<run_id>/surface_verification.json` (raw F0.5 output).
- **Justification:** not needed — surface=web with running stack.

---

## Self-Review

(filled during F-finalization)

1. **Spec drift:** FR-01.28 is the canonical FR for embedded-terminal client-side rendering. The two new ACs amend it additively. The existing AC for `Given a registered task, when the client opens GET /api/terminal/:taskId/ws, then the upgrade succeeds against a loopback Origin, the server ensure-or-creates a pty for that taskId, and the WS receives a {type:"ready", role, shellKind, cwd} envelope on attach` is unchanged.
2. **Code conventions:** new helper `safeFit` colocated with EmbeddedTerminal.tsx (single 900-line file under the 300-line guideline that pre-dates the component — not split here per ADR-073 deviation). New ref `disposedRef` follows the existing per-mount-ref pattern (cf. `injectionInFlightRef`, `dataSeenInitiallyRef`).
3. **Architecture rules:** Plan-D'' compliance unchanged (no Claude spawn; LaunchCoordinatorContext.dispatchAutoLaunch path stays user-initiated). CLAUDE.md DO-NOT regression guards #17 + #18 + #19 untouched.
4. **DO-NOT carve-outs:** none added.
5. **Side effects:** none — pure client-side state + render logic.
6. **Test coverage:** every AC has a corresponding empirical test layer (E2E for AC-1+AC-2+AC-3; unit for server-side promotion regression fence).
7. **Affected boundaries:** none — confirmed in section above.
