/*
 * HeaderMenu — extracted from TaskDetailHeader (Campaign C / C6).
 *
 * Owns:
 *   - Mutations + handlers for menu actions (close, backlog, delete,
 *     stop-terminal, copy-uuid, copy-resume-command).
 *   - menuNotice transient feedback span (Copy ⋯ success / failure).
 *   - Composition of `HeaderMenuItems` (the dropdown JSX) and
 *     `ConfirmClearHistoryDialog` — both extracted to keep every file
 *     under the 300-LOC cleanup-invariant ceiling.
 *
 * Stable props: receives `task` + a small set of callbacks for actions
 * that need to lift state into the shell (rename ref forwarding, edit
 * modal, confirm-delete dialog, debug toggle, project picker popover).
 *
 * The fifth sub-component beyond the 4 named in the campaign spec — see
 * the iterate spec §"Scope note — 5 sub-components, not 4".
 *
 * Per OAI-5 / GEM-5: Radix Portal usage + requestAnimationFrame deferral
 * of the confirm-clear-history dialog opening are preserved verbatim
 * (Iterate v0.8.2 AC-1 fix). Focus-trap interactions stay identical.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "react-router-dom";

import type { ExternalTask } from "../../../lib/externalApi";
import {
  useCloseExternalTask,
  useMoveTaskToBacklog,
} from "../../../hooks/useExternalTasks";
import { copyText } from "../../../lib/clipboard";
import { ConfirmClearHistoryDialog } from "./ConfirmClearHistoryDialog";
import { HeaderMenuItems } from "./HeaderMenuItems";

export interface HeaderMenuProps {
  task: ExternalTask;
  onOpenEditTask: () => void;
  onRename: () => void;
  onOpenProjectPicker: () => void;
  /**
   * Delete-action callback. The shell owns the single `deleteMut`
   * instance and decides — based on `task.state` — whether to delete
   * immediately or open the confirm dialog. HIGH-2 fix (C6 code review):
   * keeping delete ownership in one place preserves bit-perfect mutation
   * lifecycle semantics (single isPending / error / cache subscription).
   */
  onDeleteClick: () => void;
  onToggleDebug: () => void;
  showDebug: boolean;
}

export function HeaderMenu({
  task,
  onOpenEditTask,
  onRename,
  onOpenProjectPicker,
  onDeleteClick,
  onToggleDebug,
  showDebug,
}: HeaderMenuProps) {
  const closeMut = useCloseExternalTask();
  const backlogMut = useMoveTaskToBacklog();
  const navigate = useNavigate();

  const [menuNotice, setMenuNotice] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const menuNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmClearHistoryOpen, setConfirmClearHistoryOpen] = useState(false);

  const flashMenuNotice = useCallback((kind: "ok" | "err", text: string) => {
    setMenuNotice({ kind, text });
    if (menuNoticeTimer.current) clearTimeout(menuNoticeTimer.current);
    menuNoticeTimer.current = setTimeout(() => setMenuNotice(null), 2600);
  }, []);

  // Clear the pending notice-reset timer on unmount so it can't fire a
  // setState after the component (and, in tests, the jsdom window) is gone.
  useEffect(() => {
    return () => {
      if (menuNoticeTimer.current) clearTimeout(menuNoticeTimer.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    closeMut.mutate(task.taskId, { onSuccess: () => navigate("/") });
  }, [closeMut, navigate, task.taskId]);

  const handleMoveToBacklog = useCallback(() => {
    backlogMut.mutate(task.taskId);
  }, [backlogMut, task.taskId]);

  const handleStopTerminal = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(task.taskId)}/close`,
        { method: "POST" },
      );
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[task-detail] stop-terminal returned HTTP ${res.status}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[task-detail] stop-terminal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [task.taskId]);

  const handleCopyUuid = useCallback(async () => {
    try {
      await copyText(task.sessionUuid);
      flashMenuNotice("ok", "Session UUID copied");
    } catch (err) {
      flashMenuNotice(
        "err",
        `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [task.sessionUuid, flashMenuNotice]);

  const handleCopyResumeCommand = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/external/tasks/${encodeURIComponent(task.taskId)}/launch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume: true, dryRun: true }),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        );
      }
      const body = (await res.json().catch(() => null)) as
        | { commands?: { powershell?: string; posix?: string } }
        | null;
      const isWindows = /windows/i.test(
        typeof navigator !== "undefined" ? navigator.userAgent : "",
      );
      const cmd = isWindows
        ? body?.commands?.powershell
        : body?.commands?.posix;
      if (!cmd) throw new Error("server returned no command");
      await copyText(cmd);
      flashMenuNotice("ok", "Resume command copied — paste it in a terminal");
    } catch (err) {
      flashMenuNotice(
        "err",
        `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [task.taskId, flashMenuNotice]);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] text-[var(--color-muted,#6b7280)] transition hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
            data-testid="task-detail-menu-trigger"
          >
            <MoreVertical size={16} />
          </button>
        </DropdownMenu.Trigger>
        <HeaderMenuItems
          task={task}
          showDebug={showDebug}
          onRename={onRename}
          onEditTask={onOpenEditTask}
          onCopyUuid={() => void handleCopyUuid()}
          onCopyResumeCommand={() => void handleCopyResumeCommand()}
          onOpenProjectPicker={onOpenProjectPicker}
          onMoveToBacklog={handleMoveToBacklog}
          onClose={handleClose}
          onStopTerminal={() => void handleStopTerminal()}
          onDeleteClick={onDeleteClick}
          onOpenClearHistory={() => setConfirmClearHistoryOpen(true)}
          onToggleDebug={onToggleDebug}
        />
      </DropdownMenu.Root>

      {menuNotice && (
        <span
          role="status"
          className="absolute left-6 top-full mt-1 rounded px-2 py-0.5 text-[11px]"
          style={
            menuNotice.kind === "ok"
              ? {
                  background: "var(--color-success-bg, #ecfdf5)",
                  color: "var(--color-success, #059669)",
                }
              : {
                  background: "var(--color-error-bg, rgba(220,38,38,0.1))",
                  color: "var(--color-error, #DC2626)",
                }
          }
          data-testid="task-detail-menu-notice"
          data-kind={menuNotice.kind}
        >
          {menuNotice.text}
        </span>
      )}

      <ConfirmClearHistoryDialog
        open={confirmClearHistoryOpen}
        onOpenChange={setConfirmClearHistoryOpen}
        taskId={task.taskId}
      />
    </>
  );
}
