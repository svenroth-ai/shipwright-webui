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
}
