/*
 * Codex Light preferences card (Settings page, AC1 + AC5).
 *
 * Two server-backed (GET/PUT /api/settings) global switches — Goal 1's
 * whole point ("flip everything to Codex when Claude Pro/Max quota is
 * exhausted, without touching every task individually") needs exactly one
 * global switch, distinct from `actions.defaults.autonomy` (per-project).
 * `RuntimeToggle` seeds every task-creation surface's on-open default from
 * `codexRuntimeDefault`, and triage promote (which has no launch form —
 * `server/src/routes/triage.ts`) reads it directly server-side.
 *
 * `codexStallTimeoutMinutes` governs `CodexTaskWatcher`'s pty-silence
 * trigger (§5.1) — the floor (5 min) is enforced server-side at watcher
 * construction, not by this input; the input only rejects a value below
 * that floor from ever being saved, so the operator gets immediate
 * feedback instead of a silently-clamped number.
 *
 * Applies immediately on change (no separate Save button), mirroring
 * TerminalSettingsCard's own immediate-apply UX for this page.
 */

import { useEffect, useState } from "react";
import { useSettings, useSaveSettings } from "../../hooks/useSettings";
import { RuntimeToggle, type RuntimeValue } from "../external/RuntimeToggle";

const MIN_STALL_TIMEOUT_MINUTES = 5;
const DEFAULT_STALL_TIMEOUT_MINUTES = 15;

export function CodexSettingsCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const [runtime, setRuntimeState] = useState<RuntimeValue>("claude");
  const [stallMinutes, setStallMinutesState] = useState<number>(DEFAULT_STALL_TIMEOUT_MINUTES);
  const [stallError, setStallError] = useState<string | null>(null);

  // Seed local state once the server value loads — mirrors how
  // TerminalSettingsCard seeds from its own (client-local) source, but here
  // the source is the server, which only resolves after mount.
  useEffect(() => {
    if (!settings) return;
    setRuntimeState(settings.codexRuntimeDefault ?? "claude");
    setStallMinutesState(settings.codexStallTimeoutMinutes ?? DEFAULT_STALL_TIMEOUT_MINUTES);
  }, [settings]);

  const changeRuntime = (next: RuntimeValue): void => {
    setRuntimeState(next);
    saveSettings.mutate({ codexRuntimeDefault: next });
  };

  const changeStallMinutes = (raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    setStallMinutesState(next);
    if (next < MIN_STALL_TIMEOUT_MINUTES) {
      setStallError(`Minimum is ${MIN_STALL_TIMEOUT_MINUTES} minutes.`);
      return;
    }
    setStallError(null);
    saveSettings.mutate({ codexStallTimeoutMinutes: next });
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
      data-testid="settings-codex"
    >
      <h2
        className="font-semibold"
        style={{ fontSize: "15px", color: "var(--color-text)", margin: 0 }}
      >
        Codex Light
      </h2>

      <div
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "4px" }}
        data-testid="settings-codex-runtime-default"
      >
        <span
          className="font-medium"
          style={{ fontSize: "14px", color: "var(--color-text)" }}
        >
          Default runtime for new tasks
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Seeds every new task's Claude/Codex toggle — including triage
          promote, which has no toggle of its own. A task keeps whatever
          runtime it was created with; changing this never affects existing
          tasks.
        </span>
        <div style={{ marginTop: "2px" }}>
          <RuntimeToggle value={runtime} onChange={changeRuntime} />
        </div>
      </div>

      <label
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "12px" }}
        data-testid="settings-codex-stall-timeout"
      >
        <span
          className="font-medium"
          style={{ fontSize: "14px", color: "var(--color-text)" }}
        >
          Codex stall timeout (minutes)
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          How long a Codex task's terminal can go silent before Shipwright
          checks in and, if the work genuinely isn't done, sends a nudge.
          Minimum {MIN_STALL_TIMEOUT_MINUTES} minutes.
        </span>
        <input
          type="number"
          min={MIN_STALL_TIMEOUT_MINUTES}
          value={stallMinutes}
          onChange={(e) => changeStallMinutes(e.target.value)}
          data-testid="settings-codex-stall-timeout-input"
          style={{
            marginTop: "2px",
            alignSelf: "flex-start",
            width: "100px",
            fontSize: "14px",
            padding: "6px 8px",
            color: "var(--color-text)",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-input, 6px)",
          }}
        />
        {stallError ? (
          <span
            style={{ fontSize: "12px", color: "var(--color-danger, #b91c1c)" }}
            data-testid="settings-codex-stall-timeout-error"
          >
            {stallError}
          </span>
        ) : null}
      </label>
    </section>
  );
}
