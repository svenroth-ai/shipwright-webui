/*
 * HeaderMenuItems — DropdownMenu.Content + items, extracted from HeaderMenu
 * (Campaign C / C6) to keep both files under the 300-LOC cleanup-invariant.
 *
 * Purely presentational: receives every action callback as a prop. No
 * state, no hooks, no fetch. The orchestrating HeaderMenu owns the
 * mutations + the menu-notice + the confirm-clear-history dialog.
 *
 * Testid stability is load-bearing (Playwright specs across the codebase
 * target every menu testid by name) — preserved verbatim.
 */
import {
  ChevronUp,
  Clipboard,
  Folder,
  Pencil,
  SquarePen,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import type { ExternalTask } from "../../../lib/externalApi";
import { isInProgressState } from "../../../lib/taskLifecycle";

function isTerminalState(state: ExternalTask["state"]): boolean {
  return state === "done";
}

export interface HeaderMenuItemsProps {
  task: ExternalTask;
  showDebug: boolean;
  onRename: () => void;
  onEditTask: () => void;
  onCopyUuid: () => void;
  onCopyResumeCommand: () => void;
  onOpenProjectPicker: () => void;
  onMoveToBacklog: () => void;
  onClose: () => void;
  onStopTerminal: () => void;
  onDeleteClick: () => void;
  onOpenClearHistory: () => void;
  onToggleDebug: () => void;
}

export function HeaderMenuItems({
  task,
  showDebug,
  onRename,
  onEditTask,
  onCopyUuid,
  onCopyResumeCommand,
  onOpenProjectPicker,
  onMoveToBacklog,
  onClose,
  onStopTerminal,
  onDeleteClick,
  onOpenClearHistory,
  onToggleDebug,
}: HeaderMenuItemsProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={6}
        className="z-50 min-w-[200px] rounded-lg border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] p-1 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
        data-testid="task-detail-menu"
      >
        <DropdownMenu.Item
          onSelect={() => onRename()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-rename"
        >
          <Pencil size={14} className="text-[var(--color-muted,#6b7280)]" />
          Rename
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => onEditTask()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-edit-task"
        >
          <SquarePen size={14} className="text-[var(--color-muted,#6b7280)]" />
          Edit task
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => {
            // resume-cta-rework — let Radix close the menu so the focus-
            // scope releases; copy on next frame so copyText's execCommand
            // fallback has no active focus-trap.
            requestAnimationFrame(() => onCopyUuid());
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-copy-uuid"
        >
          <Clipboard size={14} className="text-[var(--color-muted,#6b7280)]" />
          Copy session UUID
        </DropdownMenu.Item>
        {task.state !== "draft" && (
          <DropdownMenu.Item
            onSelect={() => requestAnimationFrame(() => onCopyResumeCommand())}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
            data-testid="task-detail-menu-copy-resume-command"
          >
            <Clipboard size={14} className="text-[var(--color-muted,#6b7280)]" />
            Copy Resume command
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item
          onSelect={() => {
            // 80 ms covers Radix cleanup + fresh tick to focus new portal.
            window.setTimeout(() => onOpenProjectPicker(), 80);
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-move-project"
        >
          <Folder size={14} className="text-[var(--color-muted,#6b7280)]" />
          Move to project…
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border,#e0dbd4)]" />
        {isInProgressState(task.state) && (
          <DropdownMenu.Item
            onSelect={() => onMoveToBacklog()}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
            data-testid="task-detail-menu-backlog"
          >
            <Undo2 size={14} className="text-[var(--color-muted,#6b7280)]" />
            Move to Backlog
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item
          disabled={isTerminalState(task.state)}
          onSelect={() => onClose()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
          data-testid="task-detail-menu-close"
        >
          <X size={14} className="text-[var(--color-muted,#6b7280)]" />
          Close task
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => onStopTerminal()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-stop-terminal"
        >
          <X size={14} className="text-[var(--color-muted,#6b7280)]" />
          Stop terminal session
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => onDeleteClick()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-error,#DC2626)] outline-none transition hover:bg-[var(--color-error,#DC2626)]/10"
          data-testid="task-detail-menu-delete"
        >
          <Trash2 size={14} className="text-[var(--color-error,#DC2626)]" />
          Delete task
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => {
            // Iterate v0.8.2 AC-1: defer modal-open to next frame to dodge
            // the Radix focus-trap race (Windows ConPTY flake).
            requestAnimationFrame(() => onOpenClearHistory());
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-error,#DC2626)] outline-none transition hover:bg-[var(--color-error,#DC2626)]/10"
          data-testid="task-detail-menu-clear-history"
        >
          <Trash2 size={14} className="text-[var(--color-error,#DC2626)]" />
          Clear terminal history
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border,#e0dbd4)]" />
        <DropdownMenu.Item
          onSelect={(e) => {
            e.preventDefault();
            onToggleDebug();
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-muted,#6b7280)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
          data-testid="task-detail-menu-toggle-debug"
        >
          <ChevronUp
            size={14}
            style={{ transform: showDebug ? "none" : "rotate(180deg)" }}
          />
          {showDebug ? "Hide session details" : "Show session details"}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
