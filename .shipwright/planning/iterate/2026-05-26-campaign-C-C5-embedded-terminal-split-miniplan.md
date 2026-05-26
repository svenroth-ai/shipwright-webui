# Mini-Plan — C5 EmbeddedTerminal.tsx split

## Files Changed (planned)

| Status   | File                                                                                | LOC est | Concern                                                                                          |
|----------|-------------------------------------------------------------------------------------|---------|--------------------------------------------------------------------------------------------------|
| MODIFIED | `client/src/components/terminal/EmbeddedTerminal.tsx`                               | 1856 → ≤250 | Shell — composes useTerminalSocket + 4 new hooks; owns JSX layer (banners + canvas)              |
| NEW      | `client/src/components/terminal/xtermAddons.ts`                                     | ≤300    | Terminal+addons factory; theme; WebGL-before-open ordering; runtime version-pin assertion         |
| NEW      | `client/src/components/terminal/usePasteImage.ts`                                   | ≤200    | DOM `paste` listener (image-wins precedence) + `uploadPasteBlob` multipart helper                |
| NEW      | `client/src/components/terminal/useTerminalResize.ts`                               | ≤220    | `safeFit` + ResizeObserver throttle + tab-activation refit + auto-focus + refresh                 |
| NEW      | `client/src/components/terminal/useAutoLaunch.ts`                                   | ≤300    | ADR-068-A1 auto-launch + manual-send + prompt-readiness handshake + ADR-108 replay-drain gate    |
| NEW      | `client/src/components/terminal/useTerminalSelection.ts`                            | ≤260    | onSelectionChange dedup + mouseup/keyup flush + mouse-mode banner + clipboard notice              |
| NEW      | `client/src/components/terminal/xtermAddons.test.ts`                                | ≤180    | RED→GREEN unit — version-pin assertion + addon-load order + no windowsMode + convertEol:false    |
| NEW      | `client/src/components/terminal/usePasteImage.test.ts`                              | ≤200    | RED→GREEN unit — image-wins; text passthrough; scope; gitignore-suggestion                       |
| NEW      | `client/src/components/terminal/useTerminalResize.test.ts`                          | ≤200    | RED→GREEN unit — throttle dedupe; tab-activation fit+refresh; safeFit guards                     |
| NEW      | `client/src/components/terminal/__ws_frame_roundtrip.test.ts`                       | ≤250    | Boundary Probe — every WS envelope shape deserialize→serialize byte-equal                        |
| UNCHANGED| `client/src/components/terminal/EmbeddedTerminal.test.tsx`                          | 2172    | All 45+ existing cases MUST pass unchanged — load-bearing behavioural fence                       |
| UNCHANGED| `client/src/hooks/useTerminalSocket.ts`                                             | 483     | Out of scope                                                                                      |
| UNCHANGED| `client/src/components/terminal/terminal-clipboard.ts`                              | 202     | Out of scope — Ctrl+V keyboard path covered here                                                  |
| UNCHANGED| `client/src/components/terminal/terminal-theme.ts`                                  | —       | Out of scope — palette tokens                                                                     |
| UNCHANGED| `client/src/components/terminal/touch-scroll.ts`                                    | —       | Out of scope — touch-scroll helper                                                                |
| MODIFIED | `shipwright_bloat_baseline.json`                                                    | —       | DELETE `EmbeddedTerminal.tsx` entry; do not add new entries                                       |
| NEW      | `.shipwright/planning/iterate/2026-05-26-campaign-C-C5-embedded-terminal-split.md`  | —       | Iterate spec                                                                                      |
| NEW      | `.shipwright/planning/iterate/2026-05-26-campaign-C-C5-embedded-terminal-split-miniplan.md` | — | This file                                                                                          |
| MODIFIED | `.shipwright/agent_docs/decision_log.md`                                            | +15     | ADR-125 — EmbeddedTerminal split                                                                  |
| NEW      | `CHANGELOG-unreleased.d/2026-05-26-campaign-C-C5-embedded-terminal-split_001.md`    | —       | Changed bullet                                                                                    |

## Build Plan (TDD — RED first)

1. **F-1 — write iterate spec + mini-plan** (this file + the spec).
2. **F-1.5 — Step 3.5 External Plan Review** (`uv run --with openai external_review.py --mode iterate`). Address every HIGH finding in the spec's implementation-contract section.
3. **F0 — write new test files (RED):**
    - `xtermAddons.test.ts` — references the not-yet-extracted module.
    - `usePasteImage.test.ts` — references not-yet-extracted hook.
    - `useTerminalResize.test.ts` — references not-yet-extracted hook.
    - `__ws_frame_roundtrip.test.ts` — Boundary Probe; runs against the not-yet-extracted envelope-parse functions.
4. **F1 — extract `xtermAddons.ts`** (pure factory; zero React). Make the test green. Verify `convertEol:false`, no `windowsMode`, WebGL-before-open, version-pin assertion.
5. **F2 — extract `useTerminalResize.ts`.** Move `safeFit` + ResizeObserver + tab-activation effect verbatim. Run new test + existing `EmbeddedTerminal.test.tsx` "auto-focus on tab activation" block. Both green.
6. **F3 — extract `usePasteImage.ts`.** Move `uploadPasteBlob` + DOM `paste` listener. New test + existing `EmbeddedTerminal.test.tsx` paste-handler block green.
7. **F4 — extract `useAutoLaunch.ts`.** Move replay-drain gate refs + auto-launch effect + reused-pty guard + manual-send + terminalReset re-arm. Existing `EmbeddedTerminal.test.tsx` AC-2 + AC-3 + AC-5 blocks (20+ cases) must remain green.
8. **F5 — extract `useTerminalSelection.ts`.** Move onSelectionChange + document listeners + MutationObserver. Existing `EmbeddedTerminal.test.tsx` selection-uxd blocks green.
9. **F6 — shrink `EmbeddedTerminal.tsx` shell.** Compose the hooks, keep JSX. Verify ≤250 LOC.
10. **F7 — full vitest run (client).** All tests green. tsc clean.
11. **F8 — server vitest:** `embedded-terminal-convert-eol.test.ts` still green.
12. **F9 — Step 3.7 External CODE Review** (`uv run --with openai external_review.py --mode code`). Address HIGH/MED findings before commit.
13. **F10 — F0.5 surface_verification.py** with `--surface web` (vitest + best-effort Playwright).
14. **F11 — F1 drift check + F3 decision log + F4 changelog drop + F5 test-results JSON + F5b finalize_iterate.**
15. **F12 — F6 commit (Conventional Commits) + F6.5 attach SHA + F7b commit-event-followup + F11 push + PR.**

## Test Strategy

**RED tests written first** (before any code is moved):

- `xtermAddons.test.ts` (8+ cases):
    1. `createEmbeddedXterm` returns `{term, fit, dispose}` shape.
    2. Constructed Terminal has `convertEol:false`.
    3. Constructed Terminal lacks `windowsMode` field (xterm 6.x).
    4. WebGL addon is loaded BEFORE `term.open()` (assert call order on spies).
    5. Theme palette wired from `EMBEDDED_TERMINAL_PALETTE` + CSS-var fallback.
    6. Version-pin assertion: reading `client/package.json` via `fs.readFileSync` in node test-mode, asserts `"@xterm/xterm"` is exactly `"6.0.0"` (no caret), `addon-fit` exactly `"0.11.0"`, addon-web-links `"0.12.0"`, addon-webgl `"0.19.0"`.
    7. `disposeXterm(term)` installs the dimensions-stub guard before calling `term.dispose()`.
    8. `rescaleOverlappingGlyphs:true`, `allowProposedApi:true`, selection knobs preserved.

- `usePasteImage.test.ts` (5+ cases):
    1. Image-wins: `image/png` file in clipboard triggers fetch to `/api/terminal/:id/paste-image` with multipart body.
    2. Text-only: routes through `term.paste(text)`; no fetch.
    3. Outside-container paste ignored (`container.contains(target)` gate).
    4. Empty clipboardData: no-op, no preventDefault.
    5. Server responds with `gitignoreSuggestion:true` → `onGitignoreSuggestion` callback fires.
    6. Server 5xx → `onPasteImageError` called.

- `useTerminalResize.test.ts` (4+ cases):
    1. `safeFit` returns false on `disposed=true` (no crash).
    2. `safeFit` returns false when renderer dims report `cellW=0` (pre-renderer-ready).
    3. ResizeObserver throttle: two rapid resize callbacks within 250 ms produce one trailing fit (not two).
    4. Active flip false→true triggers refit + `term.refresh(0, rows-1)`.
    5. Disposed component: no fit fires.

- `__ws_frame_roundtrip.test.ts` (8+ cases — one per envelope shape):
    1. `{type:"ready", role:"writer", shellKind:"pwsh", cwd, replayOnly, scrollbackBytes, retentionDays, scrollbackDir, terminalReset, ptyReused}` round-trip.
    2. `{type:"data", payload}` outbound round-trip (string-byte-stable for non-ASCII).
    3. `{type:"resize", cols, rows}` round-trip.
    4. `{type:"replay_snapshot", data, cols, rows, terminalVersion}` round-trip.
    5. `{type:"read_only"}` round-trip.
    6. `{type:"writer-promoted"}` round-trip.
    7. `{type:"backpressure", droppedBytes}` round-trip.
    8. `{type:"scrollback-meta", scrollbackBytes}` round-trip.
    9. Unknown envelope: parser returns null (no throw — back-compat fence for new server fields).

**GREEN preservation:** the existing `EmbeddedTerminal.test.tsx` (2172 LOC, 45+ cases) is the load-bearing behavioural fence. It MUST pass UNCHANGED after the refactor. If any case fails, the refactor is rejected.

## Risk + Mitigation

- **Risk:** A shared-ref miss (e.g. `disposedRef` not threaded into a hook) causes a stale-closure bug observable only at unmount. **Mitigation:** existing `EmbeddedTerminal.test.tsx` has explicit AC-3 cases for "queued chunks dropped on unmount; deferred callback is a safe no-op" — passes only if `disposedRef` survives the split.
- **Risk:** `useAutoLaunch` rewires the `onData` handler chain incorrectly and the prompt-readiness handshake misses a quiesce window. **Mitigation:** the existing AC-2 cases assert `countLaunchSends(ws)` after a controlled `ready` + `data` sequence; they're sensitive to handshake timing.
- **Risk:** Version-pin assertion test is brittle if `client/package.json` path resolution is wrong under vitest. **Mitigation:** use `path.resolve(__dirname, '../../../package.json')` + `fs.readFileSync` (synchronous, deterministic); the test reads the actual file, not a mocked one.
- **Risk:** Playwright E2E for the new C5 spec (`C5-embedded-terminal-split-smoke.spec.ts`) demands an isolated server stack on non-default ports — multi-hour infrastructure setup. **Mitigation (documented in Confidence Calibration):** the `EmbeddedTerminal.test.tsx` AC-2 cases + `__ws_frame_roundtrip.test.ts` Boundary Probe replace this E2E as the empirical anchor. The existing terminal E2E suite (73 / 82 / v0-9-6) is run best-effort under the F0.5 Playwright sweep.
- **Risk:** External-code-review surfaces a HIGH finding about a moved hook (e.g. stale-deps in `useTerminalResize`). **Mitigation:** address before F6 commit (memory `feedback_external_code_review_catches_high_bugs`).
