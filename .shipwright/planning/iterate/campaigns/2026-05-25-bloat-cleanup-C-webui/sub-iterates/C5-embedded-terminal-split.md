# Sub-Iterate C5 — EmbeddedTerminal.tsx split (HIGH RISK)

- **Campaign:** 2026-05-25-bloat-cleanup-C-webui
- **Source plan row:** §6.2 C5
- **Risk:** **HOCH** — xterm.js + node-pty + WS data-frame coupling extrem fragil. Auto-execute (ADR-068-A1) + replay-snapshot (ADR-087/097/098) precedence + convertEol:false (memory `project_bug_b_remount_smear_writerace`) all live here.
- **Complexity:** medium (4 extracted modules + shell; HIGH-RISK test demands)
- **Surface:** `web` (Playwright — E2E mandatory, not optional)
- **Branch base:** C7's branch (stacked)
- **Type:** refactor (change with classification = none)

## Goal

Split `client/src/components/terminal/EmbeddedTerminal.tsx` (1856 LOC — grew from 1479 at source-plan time) into a thin shell (≤250 LOC) + 3 new sub-modules. The `useTerminalSocket` hook already exists and stays; we add:
- `usePasteImage.ts` — handles Ctrl+V image-paste flow per memory `feedback_xterm_clipboard_async_api` (attachCustomKeyEventHandler + clipboard.read())
- `useTerminalResize.ts` — fit-addon + refit on tab activation + ResizeObserver
- `terminal/xtermAddons.ts` — addon registration (`@xterm/addon-fit`, `addon-web-links`, `addon-webgl`) with exact-pinned versions per CLAUDE.md rule 22

## Acceptance Criteria

- [ ] (E) New `client/src/components/terminal/usePasteImage.ts` exists, ≤300 LOC. Returns `{ attachClipboardHandler: (term: Terminal) => () => void }`. Uses `attachCustomKeyEventHandler` + async Clipboard API per memory `feedback_xterm_clipboard_async_api`. 8 MiB image cap + magic-byte mime sniff respected (CLAUDE.md rule 17 ADR-067). Image path quoting per `quotePathForShell`.
- [ ] (E) New `client/src/components/terminal/useTerminalResize.ts` exists, ≤300 LOC. Returns `{ fitAddon: FitAddon; attachResize: (containerEl, term) => () => void }`. Includes the "refit + refresh on tab activation" behavior from commit 207f5c3 (terminal-tab-autofocus iterate).
- [ ] (E) New `client/src/components/terminal/xtermAddons.ts` exists, ≤300 LOC. Addon registry + exact-pinned-version assertion at runtime (`@xterm/xterm` 6.0.0, `addon-fit` 0.11.0, `addon-web-links` 0.12.0, `addon-webgl` 0.19.0 per CLAUDE.md rule 22).
- [ ] (E) `EmbeddedTerminal.tsx` reduced to ≤250 LOC (shell composes useTerminalSocket + usePasteImage + useTerminalResize + xtermAddons, owns the `<div>` mount).
- [ ] (E) `shipwright_bloat_baseline.json` entry for `EmbeddedTerminal.tsx` REMOVED.
- [ ] (E) RED→GREEN vitest:
  - `usePasteImage.test.ts`: clipboard.read() called on Ctrl+V (memory `feedback_xterm_clipboard_async_api`); 8 MiB+1 → reject; non-image clipboard content → pass-through (no image upload). DOM `paste` listener path NOT used (regression guard).
  - `useTerminalResize.test.ts`: tab-activation handler triggers refit + refresh (memory `project_terminal_reset_banner` adjacency / commit 207f5c3); ResizeObserver attach/detach lifecycle correct.
  - `xtermAddons.test.ts`: assertion fails if any addon caret range is detected (defense against CLAUDE.md rule 22 violation); registration order deterministic.
- [ ] (E) **MANDATORY** new Playwright E2E spec `client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts` driving the ADR-068-A1 auto-execute flow end-to-end:
  - Create task → click Launch CTA → assert: pty attaches (ready envelope with `role: "writer"`), then client-side WS data-frame fires after prompt-readiness handshake quiesces (250 ms), command bytes appear in transcript.
  - The spec MUST use a raw `new WebSocket()` probe in `page.evaluate` from a non-terminal page if the first WS attach is needed (memory `strictmode_aborts_first_ws_in_e2e`).
  - Resume CTA → assert: pty reused signal (`ptyReused: true` on ready envelope) AND no duplicate launch (memory `project_resume_guard_remount_gap`).
- [ ] (E) Existing E2E specs for embedded-terminal pass post-refactor: `73-embedded-terminal.spec.ts`, `82-v0.8.6-terminal-reattach-smoke.spec.ts`, `v0-9-6-live-pty-replay.spec.ts`, and all of CLAUDE.md rule-22 regression guards.
- [ ] (E) Server vitest `@xterm/headless convertEol:false` regression test (committed in PR #28) still passes — `cmd /c npm.cmd --prefix server run test` with `SHIPWRIGHT_NETWORK_PROFILE=local`.
- [ ] (E) Bloat-check PR-comment ✅ no anti-ratchet AND zero advisory crossings.

## Spec Impact

- **Classification:** none
- **NONE justification:** Internal refactor. Terminal behavior must be bit-perfect — that's the whole risk story.

## Affected Boundaries

| Producer | Consumer | Format |
|---|---|---|
| `EmbeddedTerminal` shell (WS frame writer) | `server/src/terminal/routes.ts` (WS handler) | binary + JSON envelopes |
| `usePasteImage` (POST /paste-image) | `server/src/terminal/routes.ts` | multipart upload |

`touches_io_boundary` = YES — WS envelope shape MUST stay exact across refactor. Boundary Probe mandatory. The runner MUST add a deserialize/serialize round-trip vitest that asserts WS-frame schema parity pre/post split.

## Verification (F0.5)

- **Surface:** `web` (mandatory — unit-only is insufficient per memory `feedback_browser_fixes_need_real_browser_smoke`)
- **Runner commands:**
  ```bash
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/terminal
  # Boundary Probe — WS frame round-trip
  cd client && cmd /c node_modules\.bin\vitest.cmd run src/components/terminal/__ws_frame_roundtrip.test.ts
  # Mandatory new E2E
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts client/e2e/flows/C5-embedded-terminal-split-smoke.spec.ts
  # Regression coverage for the entire terminal stack
  cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts -g "terminal|embedded|pty|replay|reattach|paste"
  # Server vitest for headless mirror convertEol:false regression
  cd server && SHIPWRIGHT_NETWORK_PROFILE=local cmd /c node_modules\.bin\vitest.cmd run
  ```
- **Evidence path:** vitest log + playwright-report/index.html + screenshots from the new C5 E2E + surface_verification.json.
- **`tests_run` MUST be ≥ 15.**

## Confidence Calibration (mandatory — HIGH RISK)

- **Boundaries touched:** WS envelope (binary + JSON), clipboard async API, image-paste multipart, xterm addon-pin version contract.
- **Empirical probes run:**
  1. WS envelope round-trip vitest (deserialize → serialize → byte-equal)
  2. Clipboard `read()` invocation probe in vitest with jsdom shim
  3. Real-browser Playwright C5 smoke spec driving auto-execute end-to-end
  4. Resume-path probe (`ptyReused: true`)
  5. convertEol:false server-side regression
  6. xterm addon version-assertion probe
- **Edge cases NOT probed + why acceptable:**
  - Windows-only `windowsMode` removal (CLAUDE.md rule 22) — covered structurally by xtermAddons.ts assertion test, not by a runtime browser probe.
  - WebGL renderer fallback to canvas — manual confirm only; acceptable because Playwright runs against Chromium with WebGL on by default.
- **Confidence-pattern check:** if any "are you confident?"-yes-then-bug pattern fires in this run, the runner MUST run one more empirical probe before F11.

## External Review + Code Review (ADR-029)

- Step 3.5: **RUN** (medium + HIGH RISK).
- Step 3.7: **RUN** via orchestrator-spawned code-reviewer (parallel with build).
- **Additional:** External-LLM **code-review** mode also required at finalize per memory `feedback_external_code_review_catches_high_bugs` — `uv run --with openai shared/scripts/tools/external_review.py --mode code` over the iterate diff BEFORE finalization.

## Hard constraints

- Resume CTA label MUST stay "Resume" (memory `feedback_resume_label_singular`) — tested by C6's regression test which still runs.
- `convertEol:false` everywhere on the xterm side (memory `project_bug_b_remount_smear_writerace`).
- xterm 6.x: NO `windowsMode` option (CLAUDE.md rule 22).
- `CLAUDE_CODE_NO_FLICKER` default ON stays (CLAUDE.md rule 22).
- Auto-execute flow is via CLIENT-SIDE WS data-frame, NOT server-side `pty.write` (CLAUDE.md rule 19 ADR-068-A1).
- Image-paste path-guard: `realPathGuard` + magic-byte mime sniff + 8 MiB cap (CLAUDE.md rule 17).
- DO NOT touch `scripts/hooks/anti_ratchet_check.py`.
- DO NOT re-introduce legacy chunked replay envelopes (CLAUDE.md rule 20).

---

See [`_cleanup-invariant.md`](./_cleanup-invariant.md) for the cleanup-invariant block.
