/*
 * EditTaskModal — re-edit a task's fields after creation.
 * iterate-2026-05-18-edit-task-dialog.
 *
 * One dialog, one rule. Which fields are editable is decided ENTIRELY by
 * `lib/taskEditability.ts`:
 *   - never-started Backlog task → every field editable;
 *   - task that has started      → the four launch-shaping fields
 *     (description / phase / priority / complexityHint) render read-only;
 *     only title / domain / tags / blockedBy stay editable.
 * The server enforces the same rule (PATCH → 409 `field_not_editable`),
 * so a stale dialog can never mutate a frozen field.
 *
 * The field SET is gated by the task's action `modal_fields` — the exact
 * mechanism `NewIssueModal` uses — so a `new-plain` task shows no Phase
 * field. When the action catalog cannot be resolved the modal falls back
 * to the catalog-free field set (everything except Phase).
 *
 * Save sends only the CHANGED fields (a diff). An empty diff just closes.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";

import {
  ApiError,
  type ExternalTask,
  type TaskUpdatePatch,
} from "../../lib/externalApi";
import { useProjectActions } from "../../hooks/useProjectActions";
import { useUpdateTask } from "../../hooks/useExternalTasks";
import { isFieldEditable, isNeverStarted } from "../../lib/taskEditability";

/** Catalog-free fallback field set — Phase is omitted because validating a
 *  phase id needs the project's actions catalog. */
const FALLBACK_FIELDS = [
  "description",
  "domain",
  "priority",
  "complexityHint",
  "tags",
  "blockedBy",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ExternalTask;
}

/** "a, b, ,a" → ["a","b"] — trim, drop empties, dedupe. */
function parseList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function EditTaskModal({ open, onOpenChange, task }: Props) {
  // Only fetch the catalog once the dialog is open.
  const { data: projectActions, isLoading } = useProjectActions(
    open ? task.projectId : undefined,
  );
  const updateMut = useUpdateTask();
  const qc = useQueryClient();

  const neverStarted = isNeverStarted(task);
  const action = projectActions?.actions.find((a) => a.id === task.actionId);
  const phases = projectActions?.phases ?? [];
  // Field set: the resolved action's modal_fields. When the action does
  // not resolve (missing / stale `actionId`) fall back to the universal
  // metadata set — and re-include Phase whenever the catalog actually
  // delivered phases to pick from, so a never-started task is never left
  // unable to edit its phase just because the action lookup missed
  // (external code review — `FALLBACK_FIELDS` hid Phase unconditionally).
  const modalFields: string[] =
    action?.modal_fields ??
    (phases.length > 0 ? [...FALLBACK_FIELDS, "phase"] : FALLBACK_FIELDS);
  const catalogPending = isLoading && !projectActions;

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [phaseId, setPhaseId] = useState(task.phase ?? "");
  const [priority, setPriority] = useState(task.priority ?? "");
  const [complexityHint, setComplexityHint] = useState(task.complexityHint ?? "");
  const [domain, setDomain] = useState(task.domain ?? "");
  const [tagsRaw, setTagsRaw] = useState((task.tags ?? []).join(", "));
  const [blockedByRaw, setBlockedByRaw] = useState(
    (task.blockedBy ?? []).join(", "),
  );
  const [error, setError] = useState<string | null>(null);

  // Seed the form from the task each time the dialog opens. Read `task`
  // via a ref so a background re-fetch (new object, same content) does
  // not wipe in-progress edits — only the open false→true edge re-seeds.
  const taskRef = useRef(task);
  taskRef.current = task;
  useEffect(() => {
    if (!open) return;
    const t = taskRef.current;
    setTitle(t.title);
    setDescription(t.description ?? "");
    setPhaseId(t.phase ?? "");
    setPriority(t.priority ?? "");
    setComplexityHint(t.complexityHint ?? "");
    setDomain(t.domain ?? "");
    setTagsRaw((t.tags ?? []).join(", "));
    setBlockedByRaw((t.blockedBy ?? []).join(", "));
    setError(null);
  }, [open]);

  const shows = (f: string) => f === "title" || modalFields.includes(f);
  const editable = (f: string) => isFieldEditable(f, task);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const patch: TaskUpdatePatch = {};
    const t = title.trim();
    if (t.length === 0) {
      setError("Title cannot be empty.");
      return;
    }
    if (t !== task.title) patch.title = t;
    if (shows("description") && editable("description")) {
      const d = description.trim();
      if (d !== (task.description ?? "")) patch.description = d;
    }
    if (shows("phase") && editable("phase")) {
      if (phaseId !== (task.phase ?? "")) patch.phase = phaseId;
    }
    if (shows("priority") && editable("priority")) {
      if (priority !== (task.priority ?? "")) patch.priority = priority;
    }
    if (shows("complexityHint") && editable("complexityHint")) {
      if (complexityHint !== (task.complexityHint ?? ""))
        patch.complexityHint = complexityHint;
    }
    if (shows("domain") && editable("domain")) {
      const dm = domain.trim();
      if (dm !== (task.domain ?? "")) patch.domain = dm;
    }
    if (shows("tags") && editable("tags")) {
      const parsed = parseList(tagsRaw);
      if (!sameList(parsed, task.tags ?? [])) patch.tags = parsed;
    }
    if (shows("blockedBy") && editable("blockedBy")) {
      const parsed = parseList(blockedByRaw);
      if (!sameList(parsed, task.blockedBy ?? [])) patch.blockedBy = parsed;
    }
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    setError(null);
    try {
      await updateMut.mutateAsync({ taskId: task.taskId, patch });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "field_not_editable") {
        // The task started while the dialog was open — refresh so the
        // fields re-gate to read-only (external review — stale-modal 409).
        setError(
          "This task has already started — those fields can no longer be " +
            "edited. The dialog has been refreshed.",
        );
        void qc.invalidateQueries({ queryKey: ["external-task", task.taskId] });
        void qc.invalidateQueries({ queryKey: ["external-tasks"] });
      } else if (err instanceof ApiError) {
        setError(err.detail ?? err.code);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const inputCls =
    "w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]";

  /** Read-only value display for a frozen field on a started task. */
  function readonlyValue(field: string, value: string): ReactNode {
    return (
      <div
        data-testid={`edit-task-readonly-${field}`}
        className="rounded-[var(--radius-button,8px)] border border-dashed border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-3 py-2 text-[13px] text-[var(--color-muted,#6b7280)]"
      >
        {value.trim().length > 0 ? value : "—"}
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[8%] z-50 w-[520px] max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="edit-task-modal"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-accent,#857568)]"
              aria-hidden
            >
              <Pencil size={17} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
                Edit task
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] text-[var(--color-muted,#6b7280)]">
                {neverStarted
                  ? "This task has not been launched yet — every field is editable."
                  : "This task has started — the brief, phase, priority and complexity are locked. Tags, domain and title stay editable."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="edit-task-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {catalogPending ? (
            <div
              className="px-5 py-8 text-center text-[13px] text-[var(--color-muted,#6b7280)]"
              data-testid="edit-task-loading"
            >
              Loading task fields…
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} data-testid="edit-task-modal-form">
              <div className="flex max-h-[calc(100vh-260px)] flex-col gap-3.5 overflow-y-auto px-5 py-4">
                <Field label="Title" required>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="edit-task-title-input"
                    maxLength={200}
                    className={inputCls}
                    autoFocus
                  />
                </Field>

                {shows("phase") && (
                  <Field label="Phase">
                    {editable("phase") ? (
                      <select
                        value={phaseId}
                        onChange={(e) => setPhaseId(e.target.value)}
                        data-testid="edit-task-phase-select"
                        className={inputCls}
                      >
                        <option value="">— none —</option>
                        {phases.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      readonlyValue("phase", task.phaseLabel ?? task.phase ?? "")
                    )}
                  </Field>
                )}

                {shows("description") && (
                  <Field
                    label="Description"
                    hint={editable("description") ? "the first prompt Claude sees" : undefined}
                  >
                    {editable("description") ? (
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        data-testid="edit-task-description-input"
                        className={`${inputCls} min-h-[96px] resize-y`}
                      />
                    ) : (
                      readonlyValue("description", description)
                    )}
                  </Field>
                )}

                {shows("priority") && (
                  <Field label="Priority">
                    {editable("priority") ? (
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        data-testid="edit-task-priority-select"
                        className={inputCls}
                      >
                        <option value="">— unset —</option>
                        <option value="P0">P0 (critical)</option>
                        <option value="P1">P1 (high)</option>
                        <option value="P2">P2 (medium)</option>
                        <option value="P3">P3 (low)</option>
                      </select>
                    ) : (
                      readonlyValue("priority", priority)
                    )}
                  </Field>
                )}

                {shows("complexityHint") && (
                  <Field label="Complexity hint">
                    {editable("complexityHint") ? (
                      <select
                        value={complexityHint}
                        onChange={(e) => setComplexityHint(e.target.value)}
                        data-testid="edit-task-complexity-select"
                        className={inputCls}
                      >
                        <option value="">— unset —</option>
                        <option value="small">small</option>
                        <option value="medium">medium</option>
                        <option value="large">large</option>
                      </select>
                    ) : (
                      readonlyValue("complexityHint", complexityHint)
                    )}
                  </Field>
                )}

                {shows("domain") && (
                  <Field label="Domain" hint="routing key">
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      data-testid="edit-task-domain-input"
                      placeholder="e.g. shipwright"
                      className={inputCls}
                    />
                  </Field>
                )}

                {shows("tags") && (
                  <Field label="Tags" hint="comma-separated">
                    <input
                      type="text"
                      value={tagsRaw}
                      onChange={(e) => setTagsRaw(e.target.value)}
                      data-testid="edit-task-tags-input"
                      placeholder="auth, billing"
                      className={inputCls}
                    />
                  </Field>
                )}

                {shows("blockedBy") && (
                  <Field label="Blocked by" hint="taskIds, comma-separated">
                    <input
                      type="text"
                      value={blockedByRaw}
                      onChange={(e) => setBlockedByRaw(e.target.value)}
                      data-testid="edit-task-blocked-by-input"
                      placeholder="task-x, task-y"
                      className={inputCls}
                    />
                  </Field>
                )}

                {error && (
                  <div
                    data-testid="edit-task-error"
                    className="text-[12px] text-[var(--color-error,#DC2626)]"
                  >
                    {error}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    data-testid="edit-task-cancel"
                    className="rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  data-testid="edit-task-save"
                  disabled={updateMut.isPending}
                  className="rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {updateMut.isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted,#6b7280)]">
        <span>{label}</span>
        {required && <span className="text-[var(--color-error,#DC2626)]">*</span>}
        {hint && (
          <span className="ml-auto text-[10px] font-medium normal-case tracking-normal opacity-80">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
