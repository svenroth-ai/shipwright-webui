/*
 * Terminal preferences card (Settings page).
 *
 * Surfaces the terminal Appearance selector (light/dark, FR-01.44) and the
 * GPU-acceleration toggle (iterate-2026-07-24). The former copy-on-selection
 * toggle was removed in iterate-2026-07-07-terminal-osc52-clipboard when OSC 52
 * became the sole terminal copy path (Claude copies its own selection; the
 * WebUI relays it). Persists client-side (per-browser); the running terminal
 * re-themes live on an appearance change.
 *
 * The GPU toggle is the VS Code `terminal.integrated.gpuAcceleration` analogue.
 * It is OFF by default: the WebGL glyph texture atlas is the root cause of the
 * long-running "smear"/wrong-letter class, and `term.refresh` provably cannot
 * heal it (see terminal-renderer.ts). Unlike Appearance it CANNOT apply live —
 * the renderer is chosen when the xterm instance is constructed — so the copy
 * says "next time you open a terminal" rather than pretending otherwise.
 */

import { useState } from "react";
import {
  getAppearancePref,
  setAppearancePref,
} from "../../lib/terminalPrefs";
import type { AppearancePref } from "../../lib/terminalAppearance";
import {
  isGpuAccelerationEnabled,
  isRendererOverriddenByQuery,
  setGpuAccelerationEnabled,
} from "../terminal/terminal-renderer";

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
  // Seeded from the STORED preference, not the effective renderer: a
  // `?terminalRenderer=` URL override must not make this control display (and
  // then mis-report) a value it does not own. When such an override is active
  // we say so below rather than pretend the checkbox is in charge.
  const [gpuEnabled, setGpuEnabledState] = useState<boolean>(() =>
    isGpuAccelerationEnabled(),
  );
  const [queryOverride] = useState<boolean>(() => isRendererOverriddenByQuery());

  const changeAppearance = (next: AppearancePref): void => {
    // Persist + emit the same-tab change event so an already-open terminal
    // re-themes live (FR-01.44) with no remount.
    setAppearancePref(next);
    setAppearanceState(next);
  };

  const changeGpu = (next: boolean): void => {
    // No live event on purpose: the renderer is fixed at xterm construction,
    // so an open terminal keeps its current renderer until it is rebuilt.
    setGpuAccelerationEnabled(next);
    setGpuEnabledState(next);
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

      <label
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "12px" }}
        data-testid="settings-terminal-gpu"
      >
        <span
          className="flex items-center gap-2 font-medium"
          style={{ fontSize: "14px", color: "var(--color-text)" }}
        >
          <input
            type="checkbox"
            checked={gpuEnabled}
            onChange={(e) => changeGpu(e.target.checked)}
            data-testid="settings-terminal-gpu-checkbox"
          />
          Use GPU acceleration
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Off by default. GPU drawing is faster on very fast output, but its
          glyph cache can corrupt — the cause of the terminal showing wrong or
          smeared letters. Leave this off unless you specifically want the
          speed. <strong>Applies the next time you open a terminal.</strong>
          {queryOverride ? (
            <>
              {" "}
              <strong data-testid="settings-terminal-gpu-override-note">
                A <code>?terminalRenderer=</code> link is currently overriding
                this setting — remove it from the address bar for this checkbox
                to take effect.
              </strong>
            </>
          ) : null}
        </span>
      </label>
    </section>
  );
}
