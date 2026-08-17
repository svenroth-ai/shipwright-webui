/*
 * EditTaskModalFields — the field list rendered inside EditTaskModal's
 * scroll body. Split out of EditTaskModal.tsx (iterate-2026-08-16-
 * task-lifecycle-ux-fixes — the file crossed the 300-line bloat ceiling
 * once Autonomy support was added). Purely presentational: every value and
 * setter comes from `useEditTaskForm`.
 */
import type { ReactNode } from "react";

import type { ExternalTask, PhaseDefinition } from "../../lib/externalApi";
import { AutonomyToggle } from "./AutonomyToggle";
import { FieldLabel as Field } from "./NewIssueModal/FieldLabel";
import { DESCRIPTION_MAX_LENGTH } from "./NewIssueModal/SimpleFields";
import type { UseEditTaskFormReturn } from "./useEditTaskForm";

const inputCls =
  "w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--surface-form-line,#847a75)] bg-white px-3 py-2 text-[13px] pointer-coarse:text-[16px] outline-none focus:border-[var(--color-primary,#6b5e56)]";

/** Read-only value display for a frozen field on a started task. */
function readonlyValue(field: string, value: string): ReactNode {
  return (
    <div
      data-testid={`edit-task-readonly-${field}`}
      className="rounded-[var(--radius-button,8px)] border border-dashed border-[var(--surface-form-line,#847a75)] bg-[var(--surface-form-sunken,#e4dfda)] px-3 py-2 text-[13px] text-[var(--body,#44403c)]"
    >
      {value.trim().length > 0 ? value : "—"}
    </div>
  );
}

export function EditTaskModalFields({
  form,
  phases,
  task,
}: {
  form: UseEditTaskFormReturn;
  phases: PhaseDefinition[];
  task: ExternalTask;
}) {
  const { shows, editable } = form;
  return (
    <>
      <Field label="Title" required>
        <input
          type="text"
          value={form.title}
          onChange={(e) => form.setTitle(e.target.value)}
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
              value={form.phaseId}
              onChange={(e) => form.setPhaseId(e.target.value)}
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

      {form.showAutonomyToggle && (
        <Field label="Autonomy">
          {editable("autonomy") ? (
            <AutonomyToggle value={form.autonomy} onChange={form.setAutonomy} />
          ) : (
            readonlyValue(
              "autonomy",
              form.autonomy === "autonomous" ? "Autonomous" : "Guided",
            )
          )}
        </Field>
      )}

      {shows("description") && (
        <Field
          label="Description"
          hint={
            editable("description")
              ? `the first prompt Claude sees · ${form.description.length}/${DESCRIPTION_MAX_LENGTH}`
              : undefined
          }
        >
          {editable("description") ? (
            <textarea
              value={form.description}
              onChange={(e) => form.setDescription(e.target.value)}
              data-testid="edit-task-description-input"
              maxLength={DESCRIPTION_MAX_LENGTH}
              className={`${inputCls} min-h-[96px] resize-y`}
            />
          ) : (
            readonlyValue("description", form.description)
          )}
        </Field>
      )}

      {shows("priority") && (
        <Field label="Priority">
          {editable("priority") ? (
            <select
              value={form.priority}
              onChange={(e) => form.setPriority(e.target.value)}
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
            readonlyValue("priority", form.priority)
          )}
        </Field>
      )}

      {shows("complexityHint") && (
        <Field label="Complexity hint">
          {editable("complexityHint") ? (
            <select
              value={form.complexityHint}
              onChange={(e) => form.setComplexityHint(e.target.value)}
              data-testid="edit-task-complexity-select"
              className={inputCls}
            >
              <option value="">— unset —</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          ) : (
            readonlyValue("complexityHint", form.complexityHint)
          )}
        </Field>
      )}

      {shows("domain") && (
        <Field label="Domain" hint="routing key">
          <input
            type="text"
            value={form.domain}
            onChange={(e) => form.setDomain(e.target.value)}
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
            value={form.tagsRaw}
            onChange={(e) => form.setTagsRaw(e.target.value)}
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
            value={form.blockedByRaw}
            onChange={(e) => form.setBlockedByRaw(e.target.value)}
            data-testid="edit-task-blocked-by-input"
            placeholder="task-x, task-y"
            className={inputCls}
          />
        </Field>
      )}

      {form.error && (
        <div
          data-testid="edit-task-error"
          className="text-[12px] text-[var(--color-error,#DC2626)]"
        >
          {form.error}
        </div>
      )}
    </>
  );
}
