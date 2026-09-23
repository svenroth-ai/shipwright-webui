/**
 * Mirror of `client/src/types/settings.ts` — keep in sync.
 *
 * Server's wire-shape view of GlobalSettings. Drift between the two
 * copies surfaces at the JSON boundary. The
 * `no-cross-package-imports.test.ts` drift-guard prevents
 * re-introduction of cross-package imports.
 *
 * See ADR-080 + `.shipwright/planning/iterate/2026-05-09-tsc-baseline-fix.md`.
 */

export type AutonomyOption = "guided" | "autonomous";

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
   * Seeds `RuntimeToggle`'s on-open value for a newly created task on any
   * launch surface; the operator can leave it or flip it before Launch.
   * Unlike `defaultAutonomy` (dead code, read nowhere), this field is
   * actually served by GET /api/settings and read client-side. Renamed from
   * `codexRuntimeDefault` (Codextender integration, Part B.1) — see the
   * client mirror's doc comment for why. Only meaningful when
   * `codexAvailability === "both"`.
   */
  runtimeDefault?: "claude" | "codex";
  /**
   * Codex Light §5 (AC5) — the stall-timeout field carried over from the
   * earlier app-server-based design; now governs `CodexTaskWatcher`'s pty-
   * silence trigger instead. Minutes, default 15, floor 5 (enforced where
   * the watcher is constructed, not by this type).
   */
  codexStallTimeoutMinutes?: number;
  /**
   * Codextender integration Part B.1 — which MECHANISM runs when a task's
   * runtime is "codex". See the client mirror's doc comment.
   */
  codexIntegrationMode?: "light" | "codextender";
  /**
   * Codextender integration Part B.1 — whether the per-task `RuntimeToggle`
   * shows up at all. See the client mirror's doc comment.
   */
  codexAvailability?: "both" | "claude_only" | "codex_only";
  /**
   * Codextender integration Part B.5/B.3 — the local LiteLLM proxy's port.
   * See the client mirror's doc comment. Default 4000.
   */
  codextenderPort?: number;
}
