/*
 * terminal-mouse-report — classify xterm SGR mouse reports so the embedded
 * terminal can DROP right-button events instead of forwarding them to the pty
 * (iterate-2026-07-07-terminal-rightclick-double-paste).
 *
 * Why: Claude Code treats a right-click as PASTE (from its own copy buffer). In
 * mouse-tracking mode xterm reports the right button to Claude as a SGR
 * sequence (`ESC [ < Cb ; Cx ; Cy M|m`), so a right-click made Claude paste ON
 * TOP OF the browser context-menu "Paste" that the WebUI relays (usePasteImage)
 * = a double-paste. Confirmed live: right-click + Esc (no menu Paste) still
 * pasted → Claude reacted to the reported right-click.
 *
 * Right-click is browser business (menu → Paste). Claude must not see it, so we
 * drop right-button reports. Left/middle buttons and the wheel are still
 * forwarded (Claude selection / clicks / scroll are unaffected).
 *
 * The ESC byte is built via String.fromCharCode(27) — a literal control byte in
 * source is unreliable through the editor tooling.
 */

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
