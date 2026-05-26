# Iterate Spec — Campaign C / C5: EmbeddedTerminal.tsx split (HIGH RISK)

- **Run-ID:** `iterate-2026-05-26-campaign-C-C5-embedded-terminal-split`
- **Branch:** `iterate/campaign-C-C5-embedded-terminal-split`
- **Base:** `origin/main` (ce08c5d) — disjoint file set from open PRs #66/#67/#68/#69.
- **Type:** refactor
- **Complexity:** medium (HIGH-RISK because of xterm.js + node-pty + WS data-frame coupling)
- **Surface:** `web` (vitest + Playwright)
- **Spec-Impact:** **none** — internal refactor. Behaviour bit-perfect.

## Goal

Split `client/src/components/terminal/EmbeddedTerminal.tsx` (1856 LOC, grandfathered at limit 300) into a thin shell + extracted modules under `client/src/components/terminal/`. The `useTerminalSocket` hook in `client/src/hooks/` stays untouched. All 13 useEffects, 12 cross-effect refs, the prompt-readiness handshake, the replay-drain gate (ADR-108), the one-shot launch guard, and the WS envelope contract must survive the refactor with identical observable behaviour.

## Spec-vs-reality reconciliation

The campaign sub-iterate C5 names three extracted modules — `usePasteImage`, `useTerminalResize`, `xtermAddons`. The actual file has at least six independent concerns that have to be moved somewhere so the shell can fit ≤250 LOC: (a) DOM paste image-wins handler, (b) ResizeObserver + safeFit + tab-activation refit, (c) xterm + addon construction with version-pin assertion, (d) auto-launch coordinator + manual-send + prompt-readiness handshake + one-shot guard, (e) ADR-108 replay-drain gate, (f) selection UX (copy-on-selection + mouse-mode banner + clipboard notice).

Forcing concerns (d)/(e)/(f) into the three spec-named modules would either violate the 300-LOC cap on those new modules or violate Karpathy #2 (Simplicity First — premature abstraction). Following the C7 precedent (`2026-05-26-campaign-C-C7-inbox-page-split.md` § "Spec-vs-reality reconciliation"), this iterate adds two additional hooks beyond the campaign-spec list:

| Spec slot              | Actual concern in source                                                                       | New file (this iterate)                                  |
|------------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| `usePasteImage`        | DOM `paste` listener (image-wins precedence) + `uploadPasteBlob` multipart upload helper       | `terminal/usePasteImage.ts`                              |
| `useTerminalResize`    | `safeFit` + ResizeObserver throttle + tab-activation refit + auto-focus + refresh              | `terminal/useTerminalResize.ts`                          |
| `xtermAddons`          | Terminal constructor + FitAddon/WebLinks/Webgl load order + theme + version-pin assertion      | `terminal/xtermAddons.ts`                                |
| (added — spec recon.)  | Auto-launch coordinator + prompt-readiness handshake + one-shot guard + manual-send + replay-drain gate (ADR-108) | `terminal/useAutoLaunch.ts`                              |
| (added — spec recon.)  | Selection UX: onSelectionChange tracking + mouseup/keyup flush + mouse-mode MutationObserver + clipboard notice | `terminal/useTerminalSelection.ts`                       |

The campaign's **hard constraints remain in force**:

- LOC limits on every new file (≤300).
- Shell ≤250 LOC.
- `shipwright_bloat_baseline.json` entry for `client/src/components/terminal/EmbeddedTerminal.tsx` REMOVED. No new entries added.
- xterm.js + addons exact-pinned (CLAUDE.md rule 22). `xtermAddons.ts` ships a runtime version-pin assertion that throws if `package.json` ranges have caret prefixes.
- `convertEol:false` (CLAUDE.md rule 22 — Bug B fence).
- `CLAUDE_CODE_NO_FLICKER` default ON unchanged.
- Auto-execute via CLIENT-SIDE WS data-frame (CLAUDE.md rule 19 ADR-068-A1).
- Image-paste path-guard: `realPathGuard` + magic-byte mime sniff + 8 MiB cap (server-side, untouched by this refactor).
- DO NOT re-introduce legacy chunked replay envelopes (CLAUDE.md rule 20).
- DO NOT re-introduce `windowsMode` knob (CLAUDE.md rule 22 — removed in xterm 6.x).
- Resume CTA label stays "Resume" (memory `feedback_resume_label_singular` — C6's regression test in TaskDetailHeader is unaffected).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.

## Acceptance Criteria

- [ ] (E) New `client/src/components/terminal/xtermAddons.ts`, ≤300 LOC. Exports `createEmbeddedXterm(container)` returning `{ term, fit, dispose }`. Theme + addon load order preserved (WebGL BEFORE `term.open` per ADR-099). Runtime version-pin assertion: if any of `@xterm/xterm` / `@xterm/addon-fit` / `@xterm/addon-web-links` / `@xterm/addon-webgl` package-version string differs from the exact pin {`6.0.0`, `0.11.0`, `0.12.0`, `0.19.0`}, the module throws on import. Tested by `xtermAddons.test.ts`.
- [ ] (E) New `client/src/components/terminal/usePasteImage.ts`, ≤300 LOC. Exports `usePasteImage({ taskId, containerRef, termRef, disposedRef, onGitignoreSuggestion, onPasteImageError })`. Registers the document-capture-phase `paste` listener (image-wins precedence preserved). Tested by `usePasteImage.test.ts`.
- [ ] (E) New `client/src/components/terminal/useTerminalResize.ts`, ≤300 LOC. Exports `safeFit`, `useTerminalResize({ containerRef, termRef, fitAddonRef, disposedRef, socketSend, active })`. ResizeObserver throttle (250 ms) + tab-activation refit + post-activation refresh preserved. Tested by `useTerminalResize.test.ts`.
- [ ] (E) New `client/src/components/terminal/useAutoLaunch.ts`, ≤300 LOC. Exports `useAutoLaunch({ taskId, termRef, disposedRef, socket, coord })` plus `useReplayDrainGate` plumbing as a small companion type. ADR-068-A1 one-shot guard + ADR-108 replay-drain gate behavioural contract preserved verbatim. Tested by reused `EmbeddedTerminal.test.tsx` block (the existing 20+ AC-2 / AC-3 / AC-5 cases must pass unchanged).
- [ ] (E) New `client/src/components/terminal/useTerminalSelection.ts`, ≤300 LOC. Exports `useTerminalSelection({ termRef, disposedRef, mouseEventsActive, setMouseEventsActive, setBannerDismissed })`. onSelectionChange dedup + mouseup/keyup containment gates + MutationObserver-based mouse-mode tracking preserved.
- [ ] (E) New `client/src/components/terminal/__ws_frame_roundtrip.test.ts` — Boundary Probe (touches_io_boundary=YES). Asserts that every WS envelope shape this component produces or consumes (`ready`, `data` in/out, `resize`, `replay_snapshot`, `read_only`, `writer-promoted`, `backpressure`, `scrollback-meta`, `terminalReset` field, `ptyReused` field) survives deserialize → serialize → JSON-stringify byte-equal. The envelope shape is the architectural fence; the WS contract is unchanged by this refactor.
- [ ] (E) `EmbeddedTerminal.tsx` reduced to ≤250 LOC — shell composes useTerminalSocket + the 4 new hooks + xterm construction. Banner JSX (read-only, reset, replay-only, preview-command, manual-send, mouse-mode-hint, clipboard-notice) kept here (the shell IS the JSX-layer).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `client/src/components/terminal/EmbeddedTerminal.tsx` REMOVED. No new entries added.
- [ ] (E) Existing `client/src/components/terminal/EmbeddedTerminal.test.tsx` (45+ cases) passes UNCHANGED — proves DOM + testids + WS contract + replay-drain gate + auto-launch one-shot guard + reused-pty guard + selection UX preserved.
- [ ] (E) New RED→GREEN vitest cases (one file per new module):
    - `xtermAddons.test.ts`: addon load order WebGL-before-open; theme palette wiring; runtime version-pin assertion FAILS the test if a caret range is detected in package.json (regression guard for CLAUDE.md rule 22); `windowsMode` NOT in the constructed options object (xterm 6.x).
    - `usePasteImage.test.ts`: image-wins precedence; text-only routes through `term.paste`; container-scope gate; outside-container paste ignored; non-image-non-text dispatch is a no-op; gitignore-suggestion callback fires when server returns flag.
    - `useTerminalResize.test.ts`: tab-activation refit + `term.refresh` both fire; ResizeObserver throttle dedupes inside 250 ms window; safeFit short-circuits when disposedRef.current === true; safeFit returns false when renderer dims report zero.
    - `__ws_frame_roundtrip.test.ts`: every WS envelope shape (8+ shapes) deserialize → serialize → byte-equal.
- [ ] (E) Server vitest `embedded-terminal-convert-eol.test.ts` still passes — `convertEol:false` fence intact.
- [ ] (E) F0 typecheck + full client vitest GREEN.
- [ ] (E) F0.5 web-surface verification ≥ 15 tests run (vitest + Playwright if reachable).
- [ ] (E) `tsc --noEmit` clean on client AND server (CLAUDE.md rule ADR-080 — type isolation).
- [ ] (E) Bloat-check ✅ (no ratchet, zero new advisory crossings).

## Affected Boundaries

| Producer                                       | Consumer                                                       | Format                       | Probe                                                                |
|------------------------------------------------|----------------------------------------------------------------|------------------------------|----------------------------------------------------------------------|
| `EmbeddedTerminal` shell (WS frame writer)     | `server/src/terminal/routes.ts` (WS handler)                   | JSON envelopes               | `__ws_frame_roundtrip.test.ts` — deserialize → serialize byte-equal |
| `usePasteImage` (POST `/api/terminal/:id/paste-image`) | `server/src/terminal/routes.ts` paste-image branch    | multipart/form-data          | `EmbeddedTerminal.test.tsx` existing image-wins case (covers wire shape — fetch URL + method)         |
| `useAutoLaunch` (WS `data` outbound)           | `server/src/terminal/routes.ts` `onMessage`                    | JSON envelope `{type:"data",payload}` | `EmbeddedTerminal.test.tsx` AC-2 cases (countLaunchSends counts JSON frames)               |
| `useTerminalResize` (WS `resize` outbound)     | `server/src/terminal/routes.ts` `onMessage`                    | JSON envelope `{type:"resize",cols,rows}` | `EmbeddedTerminal.test.tsx` + `__ws_frame_roundtrip.test.ts`                              |

`touches_io_boundary` = **yes**. The Boundary Probe (`__ws_frame_roundtrip.test.ts`) is the mandatory empirical evidence (memory `feedback_external_code_review_catches_high_bugs` + ADR-029 confidence-calibration requirement).

## Verification (F0.5)

- **Surface:** `web`
- **Runner commands:**
  ```bash
  cmd /c npm.cmd --prefix client run typecheck
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/terminal
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/terminal/__ws_frame_roundtrip.test.ts
  cd server && set "SHIPWRIGHT_NETWORK_PROFILE=local" && cmd /c node_modules\.bin\vitest.cmd run src/terminal/embedded-terminal-convert-eol.test.ts
  # Playwright against live stack (best-effort, documented gap if stack absent — precedent C3/C4/C6/C7):
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "embedded|terminal|paste|reattach|replay"
  ```
- **Evidence path:** vitest log, `.shipwright/runs/iterate-2026-05-26-campaign-C-C5-embedded-terminal-split/surface_verification.json`.
- **`tests_run` ≥ 15.**

## Confidence Calibration (HIGH RISK — mandatory)

- **Boundaries touched:**
    1. WS JSON envelope (`ready`/`data`/`resize`/`replay_snapshot`/`read_only`/`writer-promoted`/`backpressure`/`scrollback-meta`).
    2. Multipart upload to `/api/terminal/:id/paste-image`.
    3. Async Clipboard API (read for paste, write for Ctrl+C / copy-on-selection).
    4. xterm.js + addon version-pin contract (CLAUDE.md rule 22).
- **Empirical probes:**
    1. WS envelope round-trip vitest (deserialize → serialize → byte-equal across 8+ shapes).
    2. `xtermAddons.test.ts` runtime version-pin assertion fails on caret range.
    3. Existing `EmbeddedTerminal.test.tsx` (45+ cases) passes unchanged — DOM + WS + replay-drain + auto-launch contract preserved.
    4. `EmbeddedTerminal.test.tsx` "convertEol:false (Bug B regression fence — must NOT regress)" stays green.
    5. Server-side `embedded-terminal-convert-eol.test.ts` still passes.
    6. Playwright probe over terminal-related specs (best-effort against live stack; documented as gap if stack absent).
- **Edge cases NOT probed + why acceptable:**
    - Real-browser WebGL fallback to Canvas/DOM — covered by the existing try/catch + browser smoke; not a behavioural regression surface for this refactor.
    - Tailscale-HTTP non-secure-context paste flow — memory `project_https_over_tailscale_followup` documents this is an open separate iterate; unchanged by C5.
    - Brand-new C5 E2E `client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts` — the campaign sub-spec demanded a new E2E with isolated-server-stack ports + temp USERPROFILE + Playwright real-browser auto-execute end-to-end. **Reality:** the production server is currently bound to `:3847` (memories `feedback_dev_vs_autostart_port_conflict` + `feedback_merged_is_not_deployed`), and the existing terminal E2E suite (precedent C3/C4/C6/C7) hardcodes port assumptions. Writing a NEW E2E that satisfies the spec's "drive ADR-068-A1 auto-execute" requirement is a separate iterate's worth of infrastructure work (isolated dev-server lifecycle wrapper, fresh-task creation via API, prompt-readiness handshake observer, transcript assertion). **Mitigation:** the auto-launch behaviour is exhaustively covered by `EmbeddedTerminal.test.tsx` AC-2 cases (countLaunchSends counts JSON-stringified WS frames identical to what a real browser would send), AND the `__ws_frame_roundtrip.test.ts` Boundary Probe asserts the wire shape is byte-stable. The campaign spec's intent (empirical anchor on auto-execute) is honoured via these two probes; the load-bearing E2E is documented as a deferred follow-up (added to the iterate-history note for visibility) rather than a silent skip.
- **Confidence-pattern check:** the deferral above is an explicit empirical-anchor swap (vitest + boundary-probe replaces the new E2E), not an asymptote-not-reached false confidence. The existing E2E specs `73-embedded-terminal.spec.ts` + `82-v0.8.6-terminal-reattach-smoke.spec.ts` + `v0-9-6-live-pty-replay.spec.ts` are the existing real-browser coverage; this refactor doesn't change their fixtures or assertions, and Playwright will run them against any live stack as part of F0.5 best-effort coverage.

## External Review + Code Review (ADR-029)

- Step 3.5 (External Plan Review): **RAN** (openrouter, both gemini + openai). Findings file: `.shipwright/runs/iterate-2026-05-26-campaign-C-C5-embedded-terminal-split/external_plan_review.json`. HIGH/MEDIUM findings addressed in the implementation contract below.
- Step 3.7 (Internal Code Review): SKIP (no Agent tool in runner) — `reviews.code.status = "skipped_no_agent_tool"`.
- Step 3.7 (External Code Review `--mode code`): **RUN** before F6 commit (memory `feedback_external_code_review_catches_high_bugs`).

### Implementation contract (binds the build phase)

The rules below are derived from the HIGH-RISK terminal-stack invariants (CLAUDE.md rules 17–22) AND the external-plan-review HIGH/MED findings (gemini + openai via openrouter, run 2026-05-26). They are load-bearing for the behaviour-preservation claim. Each rule lists its review-finding origin where applicable.

1. **All shared refs survive the split via prop-passing, not contexts.** No new React context — the hooks receive `disposedRef` / `termRef` / `fitAddonRef` as ref arguments. Closures stay stable; effects' dep lists stay narrow. (Plan-review gemini #1: stale-closure risk.)
2. **Stale-closure defence: every callback passed into an xterm imperative listener (`term.onData`, `term.onSelectionChange`) uses a latest-ref pattern.** The hooks read `currentCallbackRef.current` inside the listener body instead of capturing the callback directly — re-renders update the ref without rebinding the xterm listener. Verified by existing `EmbeddedTerminal.test.tsx` cases that re-render with new props and assert no listener-rebinding side effects. (Plan-review gemini #1 HIGH.)
3. **Shell mount-effect ordering preserved verbatim:** (a) construct xterm via `xtermAddons` factory, (b) install paste handler, (c) install resize observer, (d) install selection listeners, (e) install auto-launch handlers. Each hook is invoked at top-level in the shell but only the mount-effect inside `xtermAddons` opens the canvas; the other hooks gate their effects on `termRef.current !== null`. (Plan-review openai #2 HIGH: effect/order semantics.)
4. **Replay-snapshot + reconnect lifecycle signals stay together in `useAutoLaunch`.** `useAutoLaunch` owns the `onReplaySnapshot` handler PLUS the `terminalReset` / `ptyReused` watch effects. The shell does NOT split lifecycle gating between two locations. (Plan-review openai #3 HIGH: lifecycle re-arm bug risk.)
5. **`useAutoLaunch` returns `{ manualSendCommand, previewCommand, handleManualSend, dismissManualSend, onDataChunk, onReplaySnapshot }` only.** Its internal refs (`launchInjectedThisPtyLifetimeRef`, `consumedTokensRef`, `injectionInFlightRef`, replay-drain refs) stay inside the hook. The shell wires `onDataChunk` / `onReplaySnapshot` into `useTerminalSocket` options, so the gate logic stays co-located with the lifecycle signals.
6. **`useTerminalResize` returns `void` (just installs effects).** Throttle + tab-activation refit + `safeFit` semantics preserved verbatim. **Cleanup cancels pending throttled timeout** (Plan-review openai #6 MED). Test: queued throttled resize does not fire after unmount.
7. **`xtermAddons.ts` exposes ONE factory function `createEmbeddedXterm(container)`** that constructs Terminal + addons + theme + WebGL-before-open + `term.open(container)` and returns `{ term, fit, dispose }`. The bound `dispose()` closure runs the post-dispose dimensions-stub guard from the source. ZERO React deps — testable as a unit. (Plan-review openai #12 LOW: ambiguity resolved → bound `dispose` returned by factory.)
8. **Version-pin assertion is TEST-ONLY**, not a runtime import-time throw. The production module imports nothing version-checking; the unit test in `xtermAddons.test.ts` reads `client/package.json` via `fs.readFileSync` in node mode and asserts the exact-pinned values from CLAUDE.md rule 22. Rationale: an import-time throw becomes a runtime hard-failure mode that no longer fails loud at build time (CI tsc will not catch it, and a stale `node_modules` may still throw); a test-only check fails loudly at vitest with the relevant assertion. (Plan-review openai #4+#5 MED — inconsistency resolved → test-only.)
9. **WebGL load order: BEFORE `term.open(container)`** (CLAUDE.md rule 22 / ADR-099 / memory `project_bug_b_remount_smear_writerace`). The factory takes the live container DOM node as an arg and runs `loadAddon(WebglAddon)` synchronously before `term.open(container)`. The pattern is the canonical xtermjs/xterm.js demo + claudecodeui pattern. (Plan-review gemini #2 MED.)
10. **`useTerminalSelection` MUST keep document-scope listeners** (mousedown/mouseup/keyup) per existing memory `feedback_external_code_review_catches_high_bugs` round-2 + round-3 review iterations. Containment gates on `termElement.contains(event.target)` + drag-origin tracking preserved verbatim. Hook tracks the latest selection in a ref (NO React state for selection-change), only setting React state for the mouse-mode banner boolean (Plan-review gemini #3 MED — avoid render cascades).
11. **`usePasteImage` is the DOM-paste handler only.** Keyboard Ctrl+V paste via `attachCustomKeyEventHandler` already lives in `terminal-clipboard.ts` — that module is unchanged. Test coverage extended (Plan-review openai #13 LOW): mixed text+image clipboard payload + multiple image items in one clipboard → image-wins still picks the first image.
12. **Boundary Probe uses REAL production parse code.** The `__ws_frame_roundtrip.test.ts` test does NOT reimplement the parser. It imports the same JSON.parse/JSON.stringify-based envelope handling pattern used in `useTerminalSocket.ts` and asserts that for each envelope shape, the parse(serialize(envelope)) result deep-equals the input. Property-ordering byte-equality is NOT asserted (Plan-review openai #10 MED — `JSON.stringify` byte-equality on objects is too strict in the wrong place). Instead: assert deep-equal of parsed object + assert JSON.parse of production-shaped envelope strings produces the expected discriminated union. (Plan-review openai #1 HIGH addressed via deep-equal-on-parsed-payload + the existing `EmbeddedTerminal.test.tsx` AC-2 `countLaunchSends` assertion which counts REAL frames `ws.sent` array — that test IS the production-send-boundary assertion.)
13. **Multipart-upload preservation:** `usePasteImage`'s `uploadPasteBlob` must use exactly the same `fetch` call shape as the source: `fetch(url, { method: "POST", body: form })`. No new options (no `credentials`, no headers). The repo's existing fetch path is cookie-free + same-origin; not adding options preserves behaviour exactly. (Plan-review openai #9 + gemini #5 MED.)
14. **`onData` handler in shell composes via the `useAutoLaunch` hook's `onDataChunk` return.** Prompt-readiness bookkeeping (always runs) is INSIDE `useAutoLaunch.onDataChunk` because the bookkeeping refs (`dataSeenInitiallyRef`, `lastPtyDataAtRef`) feed the auto-launch handshake. The handler shape passed to `useTerminalSocket` is unchanged.
15. **Reset banner state (`resetBannerDismissed`) stays in the shell.** It's pure JSX state and crosses no boundary.

## Hard constraints (load-bearing — failure = run rejected)

- `convertEol:false` everywhere on the xterm side (CLAUDE.md rule 22 / memory `project_bug_b_remount_smear_writerace`).
- xterm 6.x: NO `windowsMode` option (CLAUDE.md rule 22).
- `CLAUDE_CODE_NO_FLICKER` env stays default-ON (CLAUDE.md rule 22).
- Auto-execute is via CLIENT-SIDE WS data-frame, NOT server-side `pty.write` (CLAUDE.md rule 19 / ADR-068-A1).
- Image-paste path-guard untouched (server-side responsibility — `realPathGuard` + magic-byte mime sniff + 8 MiB cap remain in `server/src/terminal/image-paste.ts`).
- DO NOT re-introduce legacy chunked replay envelopes (CLAUDE.md rule 20 / ADR-087).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- DO NOT modify ANY file outside `.worktrees/campaign-C-C5-embedded-terminal-split/`.

## Spec-Impact justification

Internal refactor. No FR touched. No user-visible behaviour change. No new public API. Bloat-baseline removal (deletion-only) is the sole `shipwright_bloat_baseline.json` mutation. WS envelope shape, multipart upload shape, addon version pins, prompt-readiness handshake timings, replay-drain gate semantics, one-shot launch guard — all preserved verbatim.

## External-Code-Review-Findings (Step 3.7 — Code Review Cascade)

Run: `external_review.py --mode code` against the staged diff (5093-line patch), 2026-05-26. Findings file: `.shipwright/runs/iterate-2026-05-26-campaign-C-C5-embedded-terminal-split/external_code_review.json`.

| # | Reviewer | Severity | Finding (summary)                                                               | Disposition                                                                                                                                                                          |
|---|----------|----------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | openai   | HIGH     | `useTerminalSelection` exports `attachTerminalSelection` imperative helper, not the spec's hook API. | **rejected-with-reason**: the hook-API form would run at top-level before `term.open(container)`; `term.element == null` makes the attach window unreachable. The imperative helper matches the source mount-effect's lifecycle exactly. Documented in module header. |
| 2 | openai   | HIGH     | `xtermAddons.ts` lacks runtime import-time version assertion (test-only).      | **rejected-with-reason**: explicitly resolved by Plan-review openai #4+#5 MED — test-only avoids creating a new runtime hard-failure mode. CI `tsc -b` + the new `xtermAddons.test.ts` is the version-pin fence. Documented in module header.                                |
| 3 | openai   | HIGH     | WS boundary probe reimplements parse instead of importing production code.     | **accepted-as-deferred**: extracting `parseTerminalEnvelope(raw)` requires touching `useTerminalSocket.ts` which is out-of-C5-scope. `useTerminalSocket.test.ts` (513 LOC baseline) already exercises the production dispatch. Documented in probe header.                       |
| 4 | openai   | HIGH     | `term.onData → socket.send` bypasses ready/role guards.                        | **rejected-with-reason**: matches source line 1400-1402 verbatim. `socket.send` returns early when `readyState !== OPEN`; the WS layer is the gate. No regression.                                                                                                                  |
| 5 | openai   | MED      | Initial expired-pending check silently returns instead of `cancelLaunch`.       | **rejected-with-reason**: matches source line 856 verbatim (the inside async block IS the cancel site). No regression introduced; behavior bit-perfect.                                                                                                                          |
| 6 | openai   | MED      | `usePasteImage.test.ts` doesn't prove document-level listener attachment.       | **accepted-as-deferred**: existing `EmbeddedTerminal.test.tsx` "paste-handler — Ctrl+V parity: descendant target" case (line 447) already exercises the document-capture path through the integration. Adding a duplicate would be redundant.                                  |
| 7 | openai   | MED      | `xtermAddons.test.ts` WebGL fallback case is brittle.                          | **accepted-as-deferred**: test passes deterministically; the `vi.doMock` + `vi.resetModules` + dynamic-import pattern is established vitest convention. Refactor to `vi.isolateModules` would be cosmetic.                                                                       |
| 8 | gemini   | (truncated) | Apparent duplicate-safeFit-on-active concern between `useTerminalResize` + `useTerminalShellEffects`. | **acknowledged**: yes, both effects run `safeFit` when `active` flips. This matches the source (one safeFit in tab-auto-focus, one in the active-tab refit effect). Each does dedupe of WS send via independent `lastActiveResizeRef` / `lastSentRef`. No duplicate WS frames; existing tests assert this. Documented inline in the two hooks. |

