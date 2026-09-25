/*
 * Presentational field list for CodexSettingsCard — split out
 * (Codextender integration Part B.1) once the card crossed the 300-line
 * guideline. Every value/handler comes from the container; this file owns
 * no state.
 */
import { RuntimeToggle, type RuntimeValue } from "../external/RuntimeToggle";
import type { GlobalSettings } from "../../types/settings";

type IntegrationMode = NonNullable<GlobalSettings["codexIntegrationMode"]>;
type Availability = NonNullable<GlobalSettings["codexAvailability"]>;

const selectStyle = {
  marginTop: "2px",
  alignSelf: "flex-start" as const,
  fontSize: "14px",
  padding: "6px 8px",
  color: "var(--color-text)",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-input, 6px)",
};

const numberInputStyle = {
  ...selectStyle,
  width: "100px",
};

export function CodexSettingsCardFields({
  runtime,
  changeRuntime,
  availability,
  changeAvailability,
  integrationMode,
  changeIntegrationMode,
  port,
  changePort,
  defaultPort,
  stallMinutes,
  changeStallMinutes,
  stallError,
  minStallTimeoutMinutes,
}: {
  runtime: RuntimeValue;
  changeRuntime: (next: RuntimeValue) => void;
  availability: Availability;
  changeAvailability: (next: Availability) => void;
  integrationMode: IntegrationMode;
  changeIntegrationMode: (next: IntegrationMode) => void;
  port: number;
  changePort: (raw: string) => void;
  defaultPort: number;
  stallMinutes: number;
  changeStallMinutes: (raw: string) => void;
  stallError: string | null;
  minStallTimeoutMinutes: number;
}) {
  return (
    <>
      <div
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "4px" }}
        data-testid="settings-codex-availability"
      >
        <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
          Which runtimes can a task use
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          "Both" shows a Claude/Codex choice on every task. "Claude only"
          hides Codex everywhere. "Codex only" forces every new task onto
          Codex — useful when Claude's quota is exhausted and you don't want
          to flip the choice on every task by hand.
        </span>
        <select
          value={availability}
          onChange={(e) => changeAvailability(e.target.value as Availability)}
          data-testid="settings-codex-availability-select"
          style={selectStyle}
        >
          <option value="both">Both — choose per task</option>
          <option value="claude_only">Claude only</option>
          <option value="codex_only">Codex only</option>
        </select>
      </div>

      <div
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "12px" }}
        data-testid="settings-codex-runtime-default"
      >
        <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
          Default runtime for new tasks
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Seeds every new task's Claude/Codex toggle — including triage
          promote, which has no toggle of its own. A task keeps whatever
          runtime it was created with; changing this never affects existing
          tasks. Only applies when both runtimes are available above.
        </span>
        <div style={{ marginTop: "2px" }}>
          <RuntimeToggle value={runtime} onChange={changeRuntime} availability={availability} />
        </div>
      </div>

      <div
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "12px" }}
        data-testid="settings-codex-integration-mode"
      >
        <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
          How a Codex task actually runs
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          "Codex Light" runs the real Codex CLI in its own terminal.
          "Codextender" instead runs a normal Claude session pointed at your
          Codex-plan subscription through a local proxy you start yourself —
          same Claude/Codex UX either way, just a different setup happens in
          the background.
        </span>
        <select
          value={integrationMode}
          onChange={(e) => changeIntegrationMode(e.target.value as IntegrationMode)}
          data-testid="settings-codex-integration-mode-select"
          style={selectStyle}
        >
          <option value="light">Codex Light</option>
          <option value="codextender">Codextender</option>
        </select>
        {/* iterate-2026-09-26-runtime-badge-and-leads-gate: moved here from
            every individual task's Runtime field — this is a global posture
            of the "Codex Light" mechanism, worth stating once where the
            mechanism is chosen, not repeated on every task. Shown whenever
            Codex Light is active and Codex is reachable at all (Claude-only
            makes the limitation moot). */}
        {integrationMode === "light" && availability !== "claude_only" && (
          <p
            className="mt-1 text-[13px] text-[var(--color-muted)]"
            data-testid="settings-codex-light-limitation-hint"
          >
            Codex Light doesn't support campaign or multi-phase pipeline
            launches yet. Use{" "}
            {availability === "codex_only" ? "Codex" : "Claude or Codex"} over
            Codextender for those.
          </p>
        )}
      </div>

      {integrationMode === "codextender" && (
        <label
          className="flex flex-col gap-[6px]"
          style={{ marginTop: "12px" }}
          data-testid="settings-codextender-port"
        >
          <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
            Codextender proxy port
          </span>
          <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
            The port your local Codextender proxy is listening on
            (`codextender --port {defaultPort}`).
          </span>
          <input
            type="number"
            min={1}
            value={port}
            onChange={(e) => changePort(e.target.value)}
            data-testid="settings-codextender-port-input"
            style={numberInputStyle}
          />
        </label>
      )}

      <label
        className="flex flex-col gap-[6px]"
        style={{ marginTop: "12px" }}
        data-testid="settings-codex-stall-timeout"
      >
        <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text)" }}>
          Codex stall timeout (minutes)
        </span>
        <span style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          How long a Codex task's terminal can go silent before Shipwright
          checks in and, if the work genuinely isn't done, sends a nudge.
          Minimum {minStallTimeoutMinutes} minutes.
        </span>
        <input
          type="number"
          min={minStallTimeoutMinutes}
          value={stallMinutes}
          onChange={(e) => changeStallMinutes(e.target.value)}
          data-testid="settings-codex-stall-timeout-input"
          style={numberInputStyle}
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
    </>
  );
}
