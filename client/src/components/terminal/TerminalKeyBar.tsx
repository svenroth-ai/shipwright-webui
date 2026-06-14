/*
 * TerminalKeyBar — on-screen key accessory bar for touch devices
 * (iterate-2026-06-14-phone-responsive-view AC-3).
 *
 * Phone / touch-tablet soft keyboards lack the keys Claude's interactive TUI
 * needs (Esc, Tab, arrows, Ctrl-C, Enter), so the terminal is undriveable on a
 * phone without them. This bar exposes them as ≥44px touch targets.
 *
 * Write path: each press resolves to a control byte sequence and is sent by the
 * parent (EmbeddedTerminal) over the SAME `socket.send({type:"data",payload})`
 * writer frame `term.onData` uses — no new server surface (ADR-067/068-A1).
 *
 * Gating (plan-review H4 + M4):
 *   - VISIBILITY is `(pointer: coarse)` ONLY (stable per device) — a
 *     reader↔writer promotion never mounts/unmounts the bar, so the pty is
 *     never resized on a role flip.
 *   - INTERACTIVITY is the writer role (`disabled` for the read-only reader).
 *   - Buttons `preventDefault()` on pointer-down so they NEVER take focus —
 *     xterm's textarea keeps focus and the soft keyboard does not drop. The
 *     dedicated ⌨ button is the only one that focuses the terminal (to summon
 *     the soft keyboard within the user gesture).
 *
 * Arrow sequences are mode-aware (plan-review H3): Claude's alt-screen TUI runs
 * in application-cursor-keys mode (DECCKM), which expects SS3 (`ESC O A`); the
 * normal buffer expects CSI (`ESC [ A`). `terminalKeySequence` is pure +
 * unit-tested; the caller passes the live `applicationCursorKeysMode`.
 */
import { useCoarsePointer } from "../../hooks/useIsCompactViewport";

export type TerminalKey =
  | "esc"
  | "tab"
  | "ctrlc"
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter";

/**
 * Map a semantic key to the exact bytes for the pty. `appCursor` selects SS3
 * (application-cursor mode, Claude's TUI) vs CSI for the four arrows.
 */
export function terminalKeySequence(key: TerminalKey, appCursor: boolean): string {
  const o = appCursor ? "O" : "[";
  switch (key) {
    case "esc":
      return "\x1b";
    case "tab":
      return "\t";
    case "ctrlc":
      return "\x03";
    case "enter":
      return "\r";
    case "up":
      return `\x1b${o}A`;
    case "down":
      return `\x1b${o}B`;
    case "right":
      return `\x1b${o}C`;
    case "left":
      return `\x1b${o}D`;
  }
}

interface TerminalKeyBarProps {
  /** Send a semantic key. The parent maps it to bytes + writes to the pty. */
  onKey: (key: TerminalKey) => void;
  /** Focus the terminal — summons the soft keyboard within the tap gesture. */
  onFocusTerminal: () => void;
  /** Disable the control keys for the read-only reader role. */
  disabled?: boolean;
}

const KEYS: { id: TerminalKey; label: string; aria: string }[] = [
  { id: "esc", label: "Esc", aria: "Escape" },
  { id: "tab", label: "Tab", aria: "Tab" },
  { id: "ctrlc", label: "⌃C", aria: "Control C" },
  { id: "left", label: "←", aria: "Arrow left" },
  { id: "up", label: "↑", aria: "Arrow up" },
  { id: "down", label: "↓", aria: "Arrow down" },
  { id: "right", label: "→", aria: "Arrow right" },
  { id: "enter", label: "⏎", aria: "Enter" },
];

const BTN =
  "flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-[6px] " +
  "px-3 text-[13px] font-medium text-[var(--color-text,#e5e5e5)] " +
  "bg-white/10 active:bg-white/25 disabled:opacity-40 disabled:active:bg-white/10";

/**
 * Touch key bar. Renders nothing on a fine-pointer (desktop) device, so the
 * ≥1024px / mouse experience is byte-identical to today.
 */
export function TerminalKeyBar({ onKey, onFocusTerminal, disabled }: TerminalKeyBarProps) {
  const coarse = useCoarsePointer();
  if (!coarse) return null;

  // Never take focus away from xterm's textarea (keeps the soft keyboard up).
  const noFocus = (e: React.PointerEvent) => e.preventDefault();

  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      data-testid="terminal-key-bar"
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-[#222] px-2 py-1.5 [padding-bottom:calc(0.375rem+env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        aria-label="Show keyboard"
        data-testid="terminal-key-keyboard"
        onPointerDown={noFocus}
        onClick={onFocusTerminal}
        className={BTN}
      >
        ⌨
      </button>
      {KEYS.map((k) => (
        <button
          key={k.id}
          type="button"
          aria-label={k.aria}
          data-testid={`terminal-key-${k.id}`}
          disabled={disabled}
          onPointerDown={noFocus}
          onClick={() => onKey(k.id)}
          className={BTN}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
