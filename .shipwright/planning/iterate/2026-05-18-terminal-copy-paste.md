# Iterate Spec: terminal-copy-paste

- **Run ID:** iterate-2026-05-18-terminal-copy-paste
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal
Add keyboard text copy — and paste where the browser permits — to the
embedded xterm terminal. Today copy is entirely unwired (no `getSelection`,
no copy key handler) and `Ctrl+V` fails silently when the WebUI is opened
over the Tailscale IP (a non-secure context, where `navigator.clipboard`
is unavailable).

Additionally, pasting a long multi-line prompt currently truncates it and
mangles the blank lines between sections: the paste path sends raw
clipboard text straight to the socket, bypassing `term.paste()`. That
skips line-ending normalization AND bracketed-paste markers
(`ESC[200~`/`ESC[201~`) — so an application with bracketed-paste mode
enabled (Claude Code's TUI, PSReadLine) reads every `\n` as a literal
Enter, submitting the prompt on its first line. This iterate routes ALL
paste through `term.paste()` to fix it.

All user-facing notices are in English (project UI-string convention).

## Acceptance Criteria
- [ ] AC-1: With a mouse selection active, `Ctrl+C` copies the selected
      text to the OS clipboard via `lib/clipboard.copyText` (whose
      `execCommand('copy')` fallback works in a non-secure context, i.e.
      over Tailscale http), then clears the xterm selection. A brief
      transient "Copied" notice confirms.
- [ ] AC-2: With NO selection active, `Ctrl+C` is passed through to the
      pty unchanged (SIGINT). The custom key handler must not swallow it.
- [ ] AC-3: `Ctrl+Insert` copies the current selection when one exists —
      the cross-platform always-copy chord VS Code also binds; no
      browser-accelerator collision. With no selection it is passed
      through to the pty (an application that binds `Ctrl+Insert` still
      receives it). `Ctrl+Shift+C` is intentionally NOT bound: it is
      Chrome's DevTools "inspect" accelerator and is not reliably
      interceptable from a browser tab (VS Code only uses it on Linux
      desktop, where Electron owns the keymap).
- [ ] AC-4: `Ctrl+V` / `Shift+Insert` paste clipboard text into the pty
      when the Clipboard API is available (secure context — localhost or
      HTTPS): the handler reads the clipboard and feeds the text through
      `term.paste()` (see AC-8) — never a raw socket frame.
- [ ] AC-5: When a paste chord is pressed in a non-secure context
      (Tailscale http, `navigator.clipboard.readText` unavailable) the
      terminal shows a clear, dismissable inline hint — "Keyboard paste
      needs HTTPS or localhost — use right-click → Paste" — instead of
      failing silently.
- [ ] AC-6: A copy failure (both clipboard paths reject) surfaces a
      visible "Copy failed" error notice — never a silent no-op.
- [ ] AC-7: Right-click → Paste continues to work via the browser's
      NATIVE context menu (the only paste path that works over Tailscale
      http — a privileged browser action fires a real `paste`
      ClipboardEvent). The `contextmenu` event is deliberately NOT
      overridden. The existing DOM `paste` listener's FR-01.29 image-wins
      precedence is untouched; its text branch is changed only to route
      through `term.paste()` per AC-8. Normal typed input is unaffected.
- [ ] AC-8: ALL text paste — the new `Ctrl+V`/`Shift+Insert` handler AND
      the existing right-click DOM `paste` listener — is fed through
      `term.paste(text)` instead of a raw `socket.send({type:"data"})`.
      `term.paste()` normalizes line endings and, when the focused
      application has enabled bracketed-paste mode (`ESC[?2004h`), wraps
      the content in `ESC[200~`/`ESC[201~`. A multi-line prompt with
      blank lines between sections pastes intact — full character count
      preserved, no truncation, no per-line submission. (MODIFY FR-01.29
      text-paste sub-behavior.)

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:**
  - FR-01.28 — the embedded terminal gains keyboard copy/paste. Row
    description gains a clause; append new `(E)` ACs for AC-1..AC-6.
  - FR-01.29 — its DOM `paste` listener text branch now routes through
    `term.paste()` (bracketed-paste + line-ending normalization);
    append an `(E)` AC for AC-7/AC-8. Image-wins precedence unchanged.
- **REMOVE:** none
- **NONE justification:** n/a
- **Affected FRs (F7):** FR-01.28, FR-01.29

## Out of Scope
- Serving the WebUI over HTTPS so `Ctrl+V` works over the Tailscale IP —
  tracked as a SEPARATE follow-up iterate (user-confirmed 2026-05-18).
  Keyboard paste over plain http cannot be fixed inside this component:
  `navigator.clipboard.readText` requires a secure context and
  `document.execCommand('paste')` is browser-blocked for web content.
- Image-paste behavior (FR-01.29) — untouched.
- Copy-on-select (auto-copy on mouse-up) — the user chose the explicit
  `Ctrl+C`-with-selection model instead.
- Middle-click paste.

## Design Notes
- No new screen. One transient inline notice ("Kopiert" / copy-failed /
  paste-hint) rendered inside the existing EmbeddedTerminal banner stack
  as a small corner pill, mirroring the existing reset-banner /
  preview-banner pattern + styling tokens.
- Tier-2 design check: text-only surface, reuses existing notice styling;
  no mockup reference needed.

## Affected Boundaries
n/a — no serialized format crosses a producer/consumer boundary. The OS
clipboard is a platform surface, not a file/IPC format this iterate
parses or round-trips.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration
- **Boundaries touched:** none — see "Affected Boundaries" (n/a). The OS
  clipboard is a platform surface, not a serialized format this iterate
  parses or round-trips.
- **Empirical probes run:**
  - 21 classifier unit tests — exhaustive chord table incl. Ctrl+Shift+C,
    Meta+*, Alt+*, keyup/keypress negatives (`terminal-clipboard.test.ts`).
  - 17 handler unit tests — copy-vs-SIGINT branch, paste, `ev.repeat`
    guard, clear-on-success-only, disposed-terminal no-op,
    unavailable/denied paste (`terminal-clipboard-handler.test.ts`).
  - 4 component wiring tests — handler registered once, Ctrl+V →
    `term.paste()`, non-secure → paste-hint pill, Ctrl+C →
    `writeText(selection)` + "Copied" pill (`EmbeddedTerminal.test.tsx`);
    plus the updated DOM right-click text-paste → `term.paste()` test.
  - 4 real-browser E2E (Chromium, live pty): Ctrl+V multi-line paste is
    CR-normalized — the sent WS frame carries `\r` escapes and ZERO `\n`,
    the decisive proof it went through `term.paste()` not the old raw
    send (AC-8); Shift+Insert paste; Ctrl+C-no-selection → SIGINT
    ``; Ctrl+C + Ctrl+Insert copy round-trip
    (`terminal-copy-paste.spec.ts` — 4/4 green against a live stack).
- **Edge cases NOT probed + why acceptable:**
  - Non-secure-context (Tailscale http) paste hint at the BROWSER level —
    Playwright runs on localhost, always a secure context. The hint path
    is covered by the handler unit test + wiring test W3 (`navigator.
    clipboard` stubbed undefined). No startable non-secure surface exists.
  - macOS Cmd+C/Cmd+V — classifier passthrough is unit-tested; no macOS
    runner available. Passthrough = native browser handling, so a
    regression surfaces as "nothing happens", never data loss.
- **Confidence-pattern check:** no "are you confident?"-style
  yes-then-bug pattern fired. The external code review surfaced 3
  test-coverage gaps (paste E2E didn't distinguish `term.paste` from raw
  send; copy wiring test didn't assert the copied text; missing-chord
  E2E) — all three addressed AND re-verified green before this gate.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `cmd /c client\node_modules\.bin\playwright.cmd test
  --config=client/playwright.config.ts
  client/e2e/flows/terminal-copy-paste.spec.ts` (run against an isolated
  prod-build server — temp `USERPROFILE` + `SHIPWRIGHT_NETWORK_PROFILE=local`)
- **Evidence path:** `client/playwright-report/` +
  `.shipwright/runs/iterate-2026-05-18-terminal-copy-paste/surface_verification.json`
