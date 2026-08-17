/*
 * EditTaskModal — re-edit a task's fields after creation.
 * iterate-2026-05-18-edit-task-dialog.
 *
 * One dialog, one rule. Which fields are editable is decided ENTIRELY by
 * `lib/taskEditability.ts`:
 *   - never-started Backlog task → every field editable;
 *   - task that has started      → the five launch-shaping fields
 *     (description / phase / priority / complexityHint / autonomy) render
 *     read-only; only title / domain / tags / blockedBy stay editable.
 * The server enforces the same rule (PATCH → 409 `field_not_editable`),
 * so a stale dialog can never mutate a frozen field.
 *
 * The field SET is gated by the task's action `modal_fields` — the exact
 * mechanism `NewIssueModal` uses — so a `new-plain` task shows no Phase
 * field. When the action catalog cannot be resolved the modal falls back
 * to the catalog-free field set (everything except Phase). Autonomy
 * visibility is derived separately (phase-aware, mirrors NewTaskModal) —
 * see `useEditTaskForm.ts`.
 *
 * Save sends only the CHANGED fields (a diff). An empty diff just closes.
 *
 * State/derivation/submit logic lives in `useEditTaskForm.ts`; the field
 * list JSX lives in `EditTaskModalFields.tsx` — this file is just the
 * Dialog shell, split out once autonomy support pushed it past the
 * 300-line bloat ceiling (iterate-2026-08-16-task-lifecycle-ux-fixes).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, X } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import { useProjectActions } from "../../hooks/useProjectActions";
import { ModalScrollBody } from "../common/ModalScrollBody";
import { EditTaskModalFields } from "./EditTaskModalFields";
import { useEditTaskForm } from "./useEditTaskForm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ExternalTask;
}

export function EditTaskModal({ open, onOpenChange, task }: Props) {
  // Only fetch the catalog once the dialog is open.
  const { data: projectActions, isLoading } = useProjectActions(
    open ? task.projectId : undefined,
  );
  const catalogPending = isLoading && !projectActions;

  const form = useEditTaskForm(task, open, projectActions, onOpenChange);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[10%] z-50 w-[540px] max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--surface-form,#edeae7)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="edit-task-modal"
        >
          <div className="flex items-center gap-3 border-b border-[var(--surface-form-divider,#c3b8ae)] px-5 py-4">
            <div
              className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-form-sunken,#e4dfda)] text-[var(--body,#44403c)]"
              aria-hidden
            >
              <Pencil size={17} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
                Edit task
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--body,#44403c)]">
                {form.neverStarted
                  ? "This task has not been launched yet — every field is editable."
                  : "This task has started — the brief, phase, priority, complexity and autonomy are locked. Tags, domain and title stay editable."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="edit-task-modal-close"
                className="rounded-[6px] p-1 text-[var(--body,#44403c)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] hover:text-[var(--ink,#1c1917)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {catalogPending ? (
            <div
              className="px-5 py-8 text-center text-[13px] text-[var(--body,#44403c)]"
              data-testid="edit-task-loading"
            >
              Loading task fields…
            </div>
          ) : (
            <form
              onSubmit={(e) => void form.onSubmit(e)}
              data-testid="edit-task-modal-form"
            >
              <ModalScrollBody
                data-testid="edit-task-modal-body"
                className="max-h-[calc(100vh-260px)] gap-3.5"
              >
                <EditTaskModalFields form={form} phases={form.phases} task={task} />
              </ModalScrollBody>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-form-divider,#c3b8ae)] bg-[var(--surface-form-sunken,#e4dfda)] px-5 py-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    data-testid="edit-task-cancel"
                    className="rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-4 py-1.5 text-[13px] font-medium text-[var(--ink,#1c1917)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)]"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  data-testid="edit-task-save"
                  disabled={form.isPending}
                  className="rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 pointer-coarse:min-h-[44px] text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {form.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
