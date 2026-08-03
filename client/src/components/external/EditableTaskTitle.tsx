/*
 * In-place editable task title for TaskDetail header.
 *
 * Click → switches to text input. Enter saves; Escape cancels; blur saves.
 * Server PATCH validates length + characters (newlines rejected). On 409
 * (lock contention from a parallel writer), the surfaced error tells the
 * user to retry — we deliberately do NOT auto-retry here, since that would
 * mask the conflict.
 *
 * The new title becomes the source of truth for the next launch's
 * `--name` flag (Claude CLI picker title). No mid-session sync.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pencil } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import type { ExternalTask } from "../../lib/externalApi";
import { useRenameTask } from "../../hooks/useExternalTasks";
import { useIsPhoneViewport } from "../../hooks/useIsCompactViewport";

interface Props {
  task: ExternalTask;
}

export interface EditableTaskTitleHandle {
  /** Imperatively enter edit mode (used by the header "Rename" menu item). */
  startEdit: () => void;
}

export const EditableTaskTitle = forwardRef<EditableTaskTitleHandle, Props>(
  function EditableTaskTitle({ task }, ref) {
  const renameMut = useRenameTask();
  const isPhone = useIsPhoneViewport();
  const [editing, setEditing] = useState(false);
  const [phonePopoverOpen, setPhonePopoverOpen] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const displayButtonRef = useRef<HTMLButtonElement | null>(null);
  const renameFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (renameFrameRef.current !== null) cancelAnimationFrame(renameFrameRef.current);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      startEdit: () => setEditing(true),
    }),
    [],
  );

  useEffect(() => {
    if (!editing) setDraft(task.title);
  }, [task.title, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === task.title) {
      setEditing(false);
      setDraft(task.title);
      setError(null);
      return;
    }
    try {
      await renameMut.mutateAsync({ taskId: task.taskId, title: trimmed });
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!editing) {
    const titleButton = (
      <button
        ref={displayButtonRef}
        type="button"
        onClick={isPhone ? undefined : () => setEditing(true)}
        className={isPhone
          ? "inline-flex min-h-11 min-w-0 items-center gap-2 truncate rounded px-1 text-left text-lg font-semibold text-[var(--color-text)] hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          : "inline-flex items-center gap-2 text-left text-lg font-semibold text-[var(--color-text)] hover:text-info"}
        aria-label={isPhone ? "Show full task title" : "Edit task title"}
        data-testid="task-title-display"
      >
        <span className={isPhone ? "truncate" : undefined}>{task.title}</span>
        {!isPhone && <Pencil size={14} className="shrink-0 text-[var(--color-muted)]" />}
      </button>
    );
    if (!isPhone) return titleButton;
    return (
      <Popover.Root modal open={phonePopoverOpen} onOpenChange={setPhonePopoverOpen}>
        <Popover.Trigger asChild>{titleButton}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              displayButtonRef.current?.focus({ preventScroll: true });
            }}
            data-testid="task-title-popover"
            className="z-50 flex max-h-[min(70vh,28rem)] w-[min(92vw,30rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-4 text-[15px] leading-6 text-[var(--ink)] shadow-xl [&>*]:shrink-0"
          >
            <p className="whitespace-pre-wrap break-words">{task.title}</p>
            <button
              type="button"
              data-testid="task-title-popover-rename"
              className="min-h-11 self-start rounded-lg bg-[var(--accent)] px-3 py-2 text-[13px] font-semibold text-white"
              onClick={() => {
                setPhonePopoverOpen(false);
                renameFrameRef.current = requestAnimationFrame(() => {
                  renameFrameRef.current = null;
                  setEditing(true);
                });
              }}
            >
              Rename
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1" data-testid="task-title-editor">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setDraft(task.title);
            setError(null);
          }
        }}
        onBlur={() => void commit()}
        disabled={renameMut.isPending}
        maxLength={200}
        className="w-full border border-[var(--info-line)] bg-white px-2 py-1 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--info-line)] disabled:opacity-50"
        style={{ borderRadius: "var(--radius-button)" }}
        data-testid="task-title-input-edit"
      />
      {error && (
        <span className="text-xs text-err" data-testid="task-title-error">
          {error}
        </span>
      )}
    </div>
  );
  },
);
