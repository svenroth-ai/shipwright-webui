/*
 * Terminal preferences card (Settings page).
 *
 * iterate-2026-06-30-terminal-paste-single-sink — surfaces the
 * copy-on-selection toggle. Default OFF (VS Code parity): selecting
 * terminal text no longer silently overwrites the OS clipboard, which
 * was the cause of "right-click paste inserts the previous clipboard
 * item too". Persists client-side (per-browser) via lib/terminalPrefs;
 * the running terminal re-reads the value live on every selection.
 */

import { useState } from "react";
import { getCopyOnSelection, setCopyOnSelection } from "../../lib/terminalPrefs";

export function TerminalSettingsCard() {
  const [copyOnSelection, setCopyOnSelectionState] = useState<boolean>(() =>
    getCopyOnSelection(),
  );

  const toggle = (next: boolean): void => {
    setCopyOnSelection(next);
    setCopyOnSelectionState(next);
  };

  return (
    <section
      className="flex flex-col gap-2"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        padding: "20px",
      }}
      data-testid="settings-terminal"
    >
      <h2
        className="font-semibold"
        style={{ fontSize: "15px", color: "var(--color-text)", margin: 0 }}
      >
        Terminal
      </h2>

      <label
        className="flex cursor-pointer items-start gap-3"
        style={{ marginTop: "4px" }}
        data-testid="settings-copy-on-selection"
      >
        <input
          type="checkbox"
          checked={copyOnSelection}
          onChange={(e) => toggle(e.target.checked)}
          style={{ marginTop: "2px", width: "16px", height: "16px" }}
          data-testid="settings-copy-on-selection-input"
        />
        <span className="flex flex-col gap-[2px]">
          <span
            className="font-medium"
            style={{ fontSize: "14px", color: "var(--color-text)" }}
          >
            Copy on selection
          </span>
          <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
            When on, selecting text in the terminal with the mouse copies it
            to the clipboard automatically. Off by default so a selection
            never overwrites what you are about to paste. Explicit Ctrl+C /
            Ctrl+Insert always copies regardless of this setting.
          </span>
        </span>
      </label>
    </section>
  );
}
