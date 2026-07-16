/*
 * Task-Board teaching empty state (A07 / FR-01.50).
 *
 * Rendered by TaskBoardPage in board view when the active project has NO tasks
 * at all (not when a status filter merely hides them — the columns keep their
 * own per-lane "none" marker for that case). One teaching sentence + exactly
 * ONE call to action, matching the campaign's teaching-empty-state pattern
 * (Spec/prototype). Honest by construction: it only shows when there is
 * genuinely nothing to see.
 */
import { Plus, LayoutGrid } from "lucide-react";

interface TaskBoardEmptyStateProps {
  /** Opens the create flow. */
  onCreate: () => void;
  /** False while the project's action catalog is still loading — the CTA is
   *  disabled rather than opening an empty modal. */
  canCreate: boolean;
}

export function TaskBoardEmptyState({ onCreate, canCreate }: TaskBoardEmptyStateProps) {
  return (
    <div className="page-container w-full pt-10 pb-8">
      <div
        className="flex flex-col items-center text-center"
        style={{ padding: "64px 16px", color: "var(--color-muted)" }}
        data-testid="task-board-empty"
      >
        <LayoutGrid size={48} className="mb-3 opacity-50" aria-hidden="true" />
        <p className="text-lg" style={{ color: "var(--color-text)" }}>
          No tasks yet
        </p>
        <p className="text-sm mb-4" data-testid="task-board-empty-sentence">
          Runs, iterates, and plain sessions you launch all land on this board.
        </p>
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          data-testid="task-board-empty-cta"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--color-primary)" }}
        >
          <Plus size={16} /> New task
        </button>
      </div>
    </div>
  );
}
