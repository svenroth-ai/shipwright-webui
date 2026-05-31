/*
 * TaskCard ⋯-menu — extracted from TaskCard.tsx in
 * iterate-2026-05-31-reopen-done-task so TaskCard.tsx stays under its
 * bloat ceiling and the lifecycle actions get a focused, testable home.
 *
 * Items + gating:
 *   - "Edit task"        — always.
 *   - "Move to Backlog"  — the five In-Progress states (canMoveToBacklog).
 *   - "Re-open"          — `done` only (isDone). Counterpart of Backlog for
 *                          the terminal state: POSTs /reopen (state → draft)
 *                          so the user can Resume the completed session.
 *   - "Close (mark done)"— always; disabled once already done.
 *   - "Delete"           — always (the card decides confirm-vs-immediate).
 *
 * Every item stops click propagation so the card's navigate-to-detail
 * handler doesn't double-fire. Testids preserved verbatim from TaskCard.tsx
 * (task-card-menu/-edit/-backlog/-close/-delete) for existing specs.
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";

interface TaskCardMenuProps {
  taskId: string;
  canMoveToBacklog: boolean;
  isDone: boolean;
  onEdit: () => void;
  onBacklog: () => void;
  onReopen: () => void;
  onClose: () => void;
  onDelete: () => void;
}

const ITEM_CLASS =
  "cursor-pointer rounded px-2 py-1 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]";

export function TaskCardMenu({
  taskId,
  canMoveToBacklog,
  isDone,
  onEdit,
  onBacklog,
  onReopen,
  onClose,
  onDelete,
}: TaskCardMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onClick={(ev) => ev.stopPropagation()}
          className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)]"
          aria-label="Task actions"
          data-testid={`task-card-menu-${taskId}`}
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[160px] rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm shadow-[var(--shadow-card)]"
        >
          {/* Edit a task's fields. Available in every state; the dialog
              itself greys out the launch-shaping fields once started. */}
          <DropdownMenu.Item
            onClick={(ev) => ev.stopPropagation()}
            onSelect={onEdit}
            className={ITEM_CLASS}
            data-testid={`task-card-edit-${taskId}`}
          >
            Edit task
          </DropdownMenu.Item>
          {/* iterate-2026-05-17-move-to-backlog (FR-01.32): In-Progress → draft. */}
          {canMoveToBacklog && (
            <DropdownMenu.Item
              onClick={(ev) => ev.stopPropagation()}
              onSelect={onBacklog}
              className={ITEM_CLASS}
              data-testid={`task-card-backlog-${taskId}`}
            >
              Move to Backlog
            </DropdownMenu.Item>
          )}
          {/* iterate-2026-05-31-reopen-done-task: done → draft. The card then
              shows Resume (firstJsonlObservedAt is set), not a fresh Launch. */}
          {isDone && (
            <DropdownMenu.Item
              onClick={(ev) => ev.stopPropagation()}
              onSelect={onReopen}
              className={ITEM_CLASS}
              data-testid={`task-card-reopen-${taskId}`}
            >
              Re-open
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            onClick={(ev) => ev.stopPropagation()}
            onSelect={onClose}
            disabled={isDone}
            className={`${ITEM_CLASS} data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40`}
            data-testid={`task-card-close-${taskId}`}
          >
            Close (mark done)
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onClick={(ev) => ev.stopPropagation()}
            onSelect={onDelete}
            className="cursor-pointer rounded px-2 py-1 text-[var(--color-error)] outline-none data-[highlighted]:bg-[var(--color-error-bg)]"
            data-testid={`task-card-delete-${taskId}`}
          >
            Delete (remove from board)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
