/**
 * Mirror of `client/src/types/task.ts` — keep in sync.
 *
 * Server's wire-shape view of Task. Drift between the two copies
 * surfaces at the JSON boundary (consumer-side compile or runtime
 * contract failure). The `no-cross-package-imports.test.ts`
 * drift-guard prevents re-introduction of `from "../../../client/..."`
 * imports.
 *
 * See ADR-080 + `.shipwright/planning/iterate/2026-05-09-tsc-baseline-fix.md`.
 */

export type KanbanStatus =
  | "backlog"
  | "in_progress"
  | "in_review"
  | "done"
  | "failed"
  | "cancelled"
  /**
   * @deprecated Iterate 14.9 — no longer returned by deriveKanbanStatus.
   * Interrupted tasks keep their phase's natural column (e.g. test →
   * in_review) and TaskCard derives the pause/Resume affordance from
   * task.status + task.orphanReason directly. Kept in the union for
   * type-level back-compat with buckets and phase-mapping configs.
   */
  | "interrupted";

export type TaskStatus =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "orphaned"
  | "interrupted"
  | "cancelled";

export type PhaseToStatusMapping = Record<string, KanbanStatus>;

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  intent?: string;
  priority?: string;
  complexity?: string;
  status: TaskStatus;
  kanbanStatus: KanbanStatus;
  currentPhase?: string;
  requestedPhase?: string;
  sessionId: string;
  /**
   * Real Claude Code CLI `session_id` captured from the `system/init`
   * NDJSON event on first spawn. Persisted via `session_captured` events
   * so that 14.7.0's "interrupted" path can `--resume <claudeSessionId>`
   * after a server restart. Undefined until Claude emits `system/init`.
   */
  claudeSessionId?: string;
  /**
   * Last `task_orphaned.detail` observed. `stale_on_startup` means the
   * server was restarted while the task was running (resumable if a
   * claudeSessionId is also present). `process_dead` means the CLI
   * exited abnormally mid-turn (not resumable).
   */
  orphanReason?: string;
  pid?: number;
  exitCode?: number;
  createdAt: string;
  updatedAt: string;
}
