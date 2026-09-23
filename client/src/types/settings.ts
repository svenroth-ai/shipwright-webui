export type AutonomyOption = 'guided' | 'autonomous';

export interface GlobalSettings {
  port: number;
  maxConcurrent: number;
  heartbeatIntervalMs: number;
  claudeCliPath?: string;
  defaultProfile?: string;
  defaultAutonomy?: AutonomyOption;
  phaseToStatusMapping?: Record<string, string>;
  /** Iterate 14.8.2 — concrete model id used as the default for new tasks. */
  defaultModel?: string;
  /** Iterate 14.8.2 — permission mode used as the default for new tasks. */
  defaultMode?: string;
  /**
   * Codex Light (Spec/codex-light-webui.md §3.5) — global runtime default.
   * Seeds RuntimeToggle's on-open value for a newly created task on any
   * launch surface; the operator can leave it or flip it before Launch.
   * Renamed from `codexRuntimeDefault` (Codextender integration, Part B.1) —
   * the field was never really Codex-specific (it seeds the default for
   * EITHER runtime), and `codexAvailability` sitting right next to it with
   * no `codex` prefix on its two non-Codex-only values made the old name's
   * asymmetry obvious. Only meaningful when `codexAvailability === "both"`.
   */
  runtimeDefault?: 'claude' | 'codex';
  /**
   * Codex Light §5 (AC5) — CodexTaskWatcher's pty-silence trigger, in
   * minutes. Default 15, floor 5.
   */
  codexStallTimeoutMinutes?: number;
  /**
   * Codextender integration Part B.1 — which MECHANISM runs when a task's
   * runtime is "codex": the real `codex` CLI as a pty TUI ("light", today's
   * behavior, unchanged) or a local LiteLLM proxy re-pointing a real
   * `claude` process at a Codex-plan model ("codextender"). Does NOT decide
   * whether Claude or Codex is available for a task at all — see
   * `codexAvailability`.
   */
  codexIntegrationMode?: 'light' | 'codextender';
  /**
   * Codextender integration Part B.1 — whether the per-task Claude/Codex
   * `RuntimeToggle` shows up at all, independent of which integration mode
   * is active. "both" = today's behavior (operator picks per task, seeded
   * from `runtimeDefault`). "claude_only" / "codex_only" hide the toggle
   * entirely and every launch surface auto-assigns the one allowed runtime.
   */
  codexAvailability?: 'both' | 'claude_only' | 'codex_only';
  /**
   * Codextender integration Part B.5/B.3 — the local LiteLLM proxy's port.
   * Used to build `ANTHROPIC_BASE_URL` for a Codextender launch, the AC8
   * proxy-reachability pre-flight, and the model-suggestion datalist source.
   * Default 4000 (matches `codextender --port 4000`'s own CLI default).
   */
  codextenderPort?: number;
}
