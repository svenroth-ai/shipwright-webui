/*
 * Terminal preferences card (Settings page).
 *
 * Surfaces the terminal Appearance selector (light/dark, FR-01.44). The
 * former copy-on-selection toggle was removed in
 * iterate-2026-07-07-terminal-osc52-clipboard when OSC 52 became the sole
 * terminal copy path (Claude copies its own selection; the WebUI relays it).
 * Persists client-side (per-browser) via lib/terminalPrefs; the running
 * terminal re-themes live on change.
 */

import { useState } from "react";
import {
  getAppearancePref,
  setAppearancePref,
} from "../../lib/terminalPrefs";
import type { AppearancePref } from "../../lib/terminalAppearance";

const APPEARANCE_OPTIONS: Array<{ value: AppearancePref; label: string }> = [
  { value: "auto", label: "Auto — match Claude Code" },
  { value: "system", label: "System (follow OS)" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function TerminalSettingsCard() {
  const [appearance, setAppearanceState] = useState<AppearancePref>(() =>
    getAppearancePref(),
  );

  const changeAppearance = (next: AppearancePref): void => {
    // Persist + emit the same-tab change event so an already-open terminal
    // re-themes live (FR-01.44) with no remount.
    setAppearancePref(next);
    setAppearanceState(next);
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
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "4px" }}
        data-testid="settings-terminal-appearance"
      >
        <span
          className="font-medium"
          style={{ fontSize: "14px", color: "var(--color-text)" }}
        >
          Appearance
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Terminal light/dark theme. <strong>Auto</strong> mirrors the theme
          you picked in Claude Code (<code>/theme</code>) — so a light Claude
          theme renders on a light terminal instead of black-on-black. Applies
          to the open terminal immediately.
        </span>
        <select
          value={appearance}
          onChange={(e) => changeAppearance(e.target.value as AppearancePref)}
          data-testid="settings-terminal-appearance-select"
          style={{
            marginTop: "2px",
            alignSelf: "flex-start",
            minWidth: "220px",
            fontSize: "14px",
            padding: "6px 8px",
            color: "var(--color-text)",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-input, 6px)",
          }}
        >
          {APPEARANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
