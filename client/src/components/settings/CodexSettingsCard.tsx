/*
 * Codex preferences card (Settings page, AC1 + AC5; Codextender integration
 * Part B.1 widened this from a single "Codex Light" toggle to three
 * independent switches — the header stays "Codex" for both mechanisms).
 *
 * Four server-backed (GET/PUT /api/settings) global switches:
 *   - `runtimeDefault` — Goal 1's whole point ("flip everything to Codex
 *     when Claude Pro/Max quota is exhausted, without touching every task
 *     individually") needs exactly one global switch, distinct from
 *     `actions.defaults.autonomy` (per-project). `RuntimeToggle` seeds
 *     every task-creation surface's on-open default from it (only
 *     meaningful when `codexAvailability === "both"`), and triage promote
 *     (which has no launch form — `server/src/routes/triage.ts`) reads it
 *     directly server-side.
 *   - `codexAvailability` — whether the per-task toggle renders at all.
 *   - `codexIntegrationMode` — which mechanism a Codex-runtime task uses:
 *     the real `codex` CLI pty TUI ("light") or the local Codextender proxy
 *     re-pointing a real `claude` process ("codextender").
 *   - `codexStallTimeoutMinutes` — governs `CodexTaskWatcher`'s pty-silence
 *     trigger (§5.1) — the floor (5 min) is enforced server-side at watcher
 *     construction, not by this input; the input only rejects a value below
 *     that floor from ever being saved, so the operator gets immediate
 *     feedback instead of a silently-clamped number. Codex-Light-specific
 *     (Codextender has no pty-silence oracle — it's an ordinary Claude
 *     session).
 *
 * Applies immediately on change (no separate Save button), mirroring
 * TerminalSettingsCard's own immediate-apply UX for this page.
 */

import { useEffect, useState } from "react";
import { useSettings, useSaveSettings } from "../../hooks/useSettings";
import type { RuntimeValue } from "../external/RuntimeToggle";
import type { GlobalSettings } from "../../types/settings";
import { CodexSettingsCardFields } from "./CodexSettingsCardFields";

const MIN_STALL_TIMEOUT_MINUTES = 5;
const DEFAULT_STALL_TIMEOUT_MINUTES = 15;
const DEFAULT_CODEXTENDER_PORT = 4000;

type IntegrationMode = NonNullable<GlobalSettings["codexIntegrationMode"]>;
type Availability = NonNullable<GlobalSettings["codexAvailability"]>;

export function CodexSettingsCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const [runtime, setRuntimeState] = useState<RuntimeValue>("claude");
  const [stallMinutes, setStallMinutesState] = useState<number>(DEFAULT_STALL_TIMEOUT_MINUTES);
  const [stallError, setStallError] = useState<string | null>(null);
  const [integrationMode, setIntegrationModeState] = useState<IntegrationMode>("light");
  const [availability, setAvailabilityState] = useState<Availability>("both");
  const [port, setPortState] = useState<number>(DEFAULT_CODEXTENDER_PORT);

  // Seed local state once the server value loads — mirrors how
  // TerminalSettingsCard seeds from its own (client-local) source, but here
  // the source is the server, which only resolves after mount.
  useEffect(() => {
    if (!settings) return;
    setRuntimeState(settings.runtimeDefault ?? "claude");
    setStallMinutesState(settings.codexStallTimeoutMinutes ?? DEFAULT_STALL_TIMEOUT_MINUTES);
    setIntegrationModeState(settings.codexIntegrationMode ?? "light");
    setAvailabilityState(settings.codexAvailability ?? "both");
    setPortState(settings.codextenderPort ?? DEFAULT_CODEXTENDER_PORT);
  }, [settings]);

  const changeRuntime = (next: RuntimeValue): void => {
    setRuntimeState(next);
    saveSettings.mutate({ runtimeDefault: next });
  };

  const changeIntegrationMode = (next: IntegrationMode): void => {
    setIntegrationModeState(next);
    saveSettings.mutate({ codexIntegrationMode: next });
  };

  const changeAvailability = (next: Availability): void => {
    setAvailabilityState(next);
    saveSettings.mutate({ codexAvailability: next });
  };

  const changePort = (raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next <= 0) return;
    setPortState(next);
    saveSettings.mutate({ codextenderPort: next });
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
        Codex
      </h2>

      <CodexSettingsCardFields
        runtime={runtime}
        changeRuntime={changeRuntime}
        availability={availability}
        changeAvailability={changeAvailability}
        integrationMode={integrationMode}
        changeIntegrationMode={changeIntegrationMode}
        port={port}
        changePort={changePort}
        defaultPort={DEFAULT_CODEXTENDER_PORT}
        stallMinutes={stallMinutes}
        changeStallMinutes={changeStallMinutes}
        stallError={stallError}
        minStallTimeoutMinutes={MIN_STALL_TIMEOUT_MINUTES}
      />
    </section>
  );
}
