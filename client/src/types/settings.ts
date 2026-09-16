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
   */
  codexRuntimeDefault?: 'claude' | 'codex';
  /**
   * Codex Light §5 (AC5) — CodexTaskWatcher's pty-silence trigger, in
   * minutes. Default 15, floor 5.
   */
  codexStallTimeoutMinutes?: number;
}
