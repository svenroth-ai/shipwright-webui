/*
 * terminal-mouse-report — classify xterm SGR mouse reports for two purposes:
 * (1) DROP right-button events instead of forwarding them to the pty
 * (iterate-2026-07-07-terminal-rightclick-double-paste); (2) tag the REST as
 * `mouse` on the wire so the server can let a read-only viewer's scroll/select
 * gestures through its writer gate (iterate-2026-08-24-terminal-readonly-
 * scroll-copy) — see `classifyOutboundTerminalData`.
 *
 * Why (1): Claude Code treats a right-click as PASTE (from its own copy
 * buffer). In mouse-tracking mode xterm reports the right button to Claude as
 * a SGR sequence (`ESC [ < Cb ; Cx ; Cy M|m`), so a right-click made Claude
 * paste ON TOP OF the browser context-menu "Paste" that the WebUI relays
 * (usePasteImage) = a double-paste. Confirmed live: right-click + Esc (no menu
 * Paste) still pasted → Claude reacted to the reported right-click.
 *
 * Right-click is browser business (menu → Paste). Claude must not see it, so we
 * drop right-button reports. Left/middle buttons and the wheel are still
 * forwarded (Claude selection / clicks / scroll are unaffected).
 *
 * Why (2): Claude's live TUI runs alt-screen + any-motion mouse tracking
 * (`?1003h`), so BOTH scroll-wheel and text-selection-for-copy are implemented
 * by the app reading these SGR reports from its stdin — xterm has no local
 * scrollback of its own in that mode (see `touch-scroll.ts`), and Claude's own
 * OSC 52 copy relay (`terminal-osc52.ts`) fires only after the app sees the
 * selection reports. A read-only viewer whose `data` messages are all blocked
 * by the server's writer gate can therefore neither scroll nor copy inside a
 * live Claude session — reported as "read-only feels frozen". Tagging these
 * reports as `mouse` lets the server allow them through for a reader while
 * still blocking real keystrokes/paste (`data`, unchanged). Scoped to SGR only
 * (matches the encoding Claude negotiates, `?1006h`) — a legacy X10 report
 * (`ESC [ M ...`) still falls through as plain `data`, same as before.
 *
 * The ESC byte is built via String.fromCharCode(27) — a literal control byte in
 * source is unreliable through the editor tooling.
 */

import type { TerminalOutbound } from "../../hooks/terminalWsContract";

const ESC = String.fromCharCode(27);
/** SGR mouse report: ESC [ < Cb ; Cx ; Cy (M|m). */
const SGR_MOUSE_REPORT = new RegExp("^" + ESC + "\\[<(\\d+);\\d+;\\d+[Mm]$");

/**
 * True when `data` is a SGR mouse report for the RIGHT button (press, release,
 * or drag). The low two bits of `Cb` are the button (0 = left, 1 = middle,
 * 2 = right); +32 is motion and +4/+8/+16 are shift/meta/ctrl. Wheel events use
 * `Cb >= 64` and are never treated as a right-click.
 */
export function isRightButtonMouseReport(data: string): boolean {
  const m = SGR_MOUSE_REPORT.exec(data);
  if (!m) return false;
  const cb = Number(m[1]);
  return cb < 64 && (cb & 0b11) === 2;
}

/** True when `data` is any SGR mouse report (any button, incl. wheel/motion). */
export function isMouseReport(data: string): boolean {
  return SGR_MOUSE_REPORT.test(data);
}

/**
 * Classify one `term.onData` byte string into the outbound WS envelope it
 * should become, or `null` to drop it silently (right-click, see above).
 * Single call site for the EmbeddedTerminal mount-effect — keeps the
 * right-click drop + reader-scroll/copy tagging decisions in one tested place.
 */
export function classifyOutboundTerminalData(data: string): TerminalOutbound | null {
  if (isRightButtonMouseReport(data)) return null;
  return { type: isMouseReport(data) ? "mouse" : "data", payload: data };
}
