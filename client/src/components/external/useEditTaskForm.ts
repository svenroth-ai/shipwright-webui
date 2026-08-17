/*
 * useEditTaskForm — state, derivation, and submit logic for EditTaskModal.
 *
 * Split out of EditTaskModal.tsx (iterate-2026-08-16-task-lifecycle-ux-fixes
 * — the file crossed the 300-line bloat ceiling once Autonomy support was
 * added). Mirrors the NewIssueModal directory's own hook/body split
 * (useNewIssueForm.ts + NewTaskModal.tsx etc.) — EditTaskModal.tsx stays the
 * presentational Dialog shell; this hook owns every stateful/derived value.
 *
 * See EditTaskModal.tsx for the field-editability rule this implements.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  type ExternalTask,
  type ResolvedProjectActions,
  type TaskUpdatePatch,
} from "../../lib/externalApi";
import { useUpdateTask } from "../../hooks/useExternalTasks";
import { isFieldEditable, isNeverStarted } from "../../lib/taskEditability";
import type { AutonomyValue } from "./AutonomyToggle";
import { resolveMode } from "./NewIssueModal/palette";

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

export function useEditTaskForm(
  task: ExternalTask,
  open: boolean,
  projectActions: ResolvedProjectActions | undefined,
  onOpenChange: (open: boolean) => void,
) {
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

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [phaseId, setPhaseId] = useState(task.phase ?? "");
  const [priority, setPriority] = useState(task.priority ?? "");
  const [complexityHint, setComplexityHint] = useState(task.complexityHint ?? "");
  const [autonomy, setAutonomy] = useState<AutonomyValue>(
    task.autonomy ?? "guided",
  );
  const [domain, setDomain] = useState(task.domain ?? "");
  const [tagsRaw, setTagsRaw] = useState((task.tags ?? []).join(", "));
  const [blockedByRaw, setBlockedByRaw] = useState(
    (task.blockedBy ?? []).join(", "),
  );
  const [error, setError] = useState<string | null>(null);

  // Mode + phase-aware autonomy visibility — the same VISIBILITY RULE
  // NewTaskModal uses (useNewIssueFormDerived.ts `showAutonomyToggle`), so
  // Edit and New never disagree about which phases support autonomy.
  //
  // `currentPhase` deliberately does NOT mirror useNewIssueFormDerived.ts's
  // `?? phases[0]` fallback (code-review finding, iterate-2026-08-16-
  // task-lifecycle-ux-fixes): that fallback exists there to give the New
  // form's first paint a provisional phase before the debounced
  // classifyPhase() effect picks one. Edit's phaseId is seeded
  // SYNCHRONOUSLY from the task on open — there is no such race — so a
  // task that genuinely has no phase (or one no longer in the catalog)
  // correctly hides the toggle instead of misrepresenting it as having
  // phases[0]'s autonomy support.
  // Fall back to the task's raw actionId (not just the resolved catalog
  // entry) so a stale/missing catalog action still resolves a bundled mode
  // correctly — resolveMode only ever reads `.id` (code-review finding,
  // iterate-2026-08-16-task-lifecycle-ux-fixes): without this, Autonomy
  // silently disappeared from a pipeline/iterate task whose action lookup
  // missed, degrading to the phase-gated new-task branch instead.
  const mode = resolveMode(action ?? (task.actionId ? { id: task.actionId } : null));
  const currentPhase = phases.find((p) => p.id === phaseId);
  const showAutonomyToggle =
    mode === "new-pipeline" ||
    mode === "new-iterate" ||
    (mode === "new-task" && currentPhase?.supports_autonomy === true);

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
    setAutonomy(t.autonomy ?? "guided");
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
    if (showAutonomyToggle && editable("autonomy")) {
      if (autonomy !== (task.autonomy ?? "guided")) patch.autonomy = autonomy;
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

  return {
    neverStarted,
    phases,
    title,
    setTitle,
    description,
    setDescription,
    phaseId,
    setPhaseId,
    priority,
    setPriority,
    complexityHint,
    setComplexityHint,
    autonomy,
    setAutonomy,
    domain,
    setDomain,
    tagsRaw,
    setTagsRaw,
    blockedByRaw,
    setBlockedByRaw,
    error,
    showAutonomyToggle,
    shows,
    editable,
    onSubmit,
    isPending: updateMut.isPending,
  };
}

export type UseEditTaskFormReturn = ReturnType<typeof useEditTaskForm>;
