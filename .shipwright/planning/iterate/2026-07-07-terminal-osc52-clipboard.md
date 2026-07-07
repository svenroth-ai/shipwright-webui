# Iterate: OSC 52 becomes the sole terminal copy path (remove the WebUI's own copy machinery)

- **run_id:** `iterate-2026-07-07-terminal-osc52-clipboard`
- **intent:** bug (copy silently failed) + behavior-preserving simplification (remove redundant machinery)
- **complexity:** medium
- **spec impact:** MODIFY — FR-01.28 (terminal copy/paste): the copy mechanism changes from WebUI Ctrl+C interception to an OSC 52 relay of Claude's own copy.

## Problem (confirmed end-to-end with the user)

After the terminal rendering reverted to Claude Code's default, Claude captures the mouse and copies the selection itself via **OSC 52** (`ESC ] 52 ; c ; <base64>`), showing "copied N chars to clipboard". But **xterm.js drops OSC 52 by default** (security), and the WebUI registered no handler — so the write never reached the OS clipboard: paste returned the *old* entry. The user's live console test (a temporary OSC 52 handler → `execCommand`) confirmed the fix: after installing it, selecting in Claude and pasting into Word worked. Over http/Tailscale the write must use the `execCommand` fallback (`navigator.clipboard` absent).

This also explains the long-standing "paste brings an old entry" reports: the *copy* never landed, so paste returned stale content. It was never a paste bug.

## Approach

1. Register an OSC 52 handler that relays writes to the OS clipboard via `copyText` (execCommand fallback), and DENIES read requests (no clipboard leak).
2. Remove the now-redundant — and partly conflicting — WebUI copy machinery: the Ctrl+C/Ctrl+Insert copy interception (it could swallow a real interrupt when a selection existed), copy-on-selection + its Settings toggle, the redraw-proof selection cache + Copy pill (iterate-2026-07-06), and the "Maus-Modus aktiv" mouse-mode hint. Paste is unchanged.

## Acceptance Criteria

- **AC-1** An OSC 52 clipboard WRITE emitted by the terminal is decoded and written to the OS clipboard (execCommand fallback → works over http).
- **AC-2** An OSC 52 READ request (`52;c;?`) is DENIED — consumed, no reply, clipboard untouched (never leak the OS clipboard to a program).
- **AC-3** Malformed / empty / oversized OSC 52 payloads are swallowed safely — no throw (would break the xterm parser), no clipboard clobber on empty, decoded size capped.
- **AC-4** The WebUI no longer intercepts Ctrl+C / Ctrl+Insert — they pass through to the pty (interrupt / SIGINT). Copy-on-selection, the redraw cache, the Copy pill, and the mouse-mode hint are removed.
- **AC-5** Paste (Ctrl+V / Shift+Insert / right-click) and the clipboard-notice (paste-hint / paste-failed / copy-failed) remain intact.
- **AC-6** The terminal Appearance setting (FR-01.44) is unaffected by removing the copy-on-selection toggle.

## Confidence Calibration
- **Boundaries touched:** terminal clipboard (client only). No IO-boundary files, no auth/rls/migration/build risk flags. Security-relevant: OSC 52 is a clipboard-write escape (read-deny is the safety boundary).
- **Empirical probes run:** (a) the user's live console OSC 52 handler over real http/Tailscale → select-in-Claude → paste-in-Word worked (root cause + fix confirmed); (b) code check — no `registerOscHandler`/OSC 52 handling existed; (c) real-browser E2E: `term.write` an OSC 52 write lands on the clipboard, and a read request leaves it untouched.
- **Test Completeness Ledger:** every AC → a test; 0 untested-testable.
- **Confidence-pattern check:** depth — decode/parse/read-deny/size-cap/empty/malformed unit-pinned; breadth — handler logic (unit), wiring + paste + Ctrl+C-passthrough (EmbeddedTerminal unit), and real-browser OSC 52 write + read-deny + paste + SIGINT (E2E). No `cross_component` machinery touched.

### Test Completeness Ledger
| Behavior | AC | Disposition | Evidence |
|---|---|---|---|
| OSC 52 write decoded + copied to clipboard | AC-1 | tested | terminal-osc52.test.ts (write relays to copy) + e2e terminal-osc52.spec.ts (write lands on clipboard) |
| OSC 52 read denied — no copy, no leak | AC-2 | tested | terminal-osc52.test.ts (read → no copy, returns true) + e2e (read leaves clipboard untouched) |
| malformed/empty/oversized swallowed safely | AC-3 | tested | terminal-osc52.test.ts (invalid → no copy; empty → no clobber; oversized → invalid; decode returns null not throw) |
| Ctrl+C / Ctrl+Insert pass through (no copy interception) | AC-4 | tested | terminal-clipboard.test.ts (classifier → passthrough) + terminal-clipboard-handler.test.ts (passthrough block) + EmbeddedTerminal.test.tsx (Ctrl+C passes through) + e2e terminal-copy-paste.spec.ts (Ctrl+C → SIGINT) |
| copy-on-selection / cache / pill / hint removed | AC-4 | tested | deleted useTerminalSelection + its tests; EmbeddedTerminal/TerminalBanners tests updated; full suite green |
| paste + notice intact | AC-5 | tested | terminal-clipboard-handler.test.ts (paste block) + e2e terminal-copy-paste.spec.ts (Ctrl+V multiline, Shift+Insert) + useTerminalClipboard.test.ts (notice) |
| appearance setting unaffected | AC-6 | tested | TerminalSettingsCard.test.tsx (appearance selector still green) |
