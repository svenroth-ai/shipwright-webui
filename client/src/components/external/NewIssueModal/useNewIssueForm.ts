/*
 * Composer for the NewIssueModal form. Glues:
 *   - useNewIssueFormState  — `useState` declarations + reset-on-open effect.
 *   - useNewIssueFormDerived — `useMemo` projections + schema-seed effect
 *                              + debounced classifyPhase effect.
 *   - useNewIssueFormSubmit — the create + launch POST sequencer with
 *                             bit-perfect payload-shape boundary.
 *
 * The split is for line-budget compliance (cleanup-invariant requires
 * every NEW source file ≤ 300 LOC). All three slices share the SAME
 * mental model — `state`, `derived`, `handlers` — that the bodies
 * consume. The composer flattens the slices into the legacy hook return
 * shape so per-body components don't need to know about the split.
 */

import { useCallback } from "react";

import { useProjectFilter } from "../../../hooks/useProjectFilter";
import { useProjects } from "../../../hooks/useProjects";
import { UNASSIGNED_PROJECT_ID } from "../../../lib/projectIds";
import type { RenderableParamSchema } from "../../../types/action-schema";

import { PALETTE, resolveMode } from "./palette";
import type { NewIssueModalProps } from "./types";
import { useNewIssueFormDerived } from "./useNewIssueFormDerived";
import { useNewIssueFormState } from "./useNewIssueFormState";
import { useNewIssueFormSubmit } from "./useNewIssueFormSubmit";

type HookInput = Pick<
  NewIssueModalProps,
  | "open"
  | "onOpenChange"
  | "action"
  | "projectActions"
  | "onTaskCreated"
  | "writeToClipboard"
  | "onToast"
  | "initialTitle"
  | "initialDescription"
  | "initialPhaseId"
  | "initialPriority"
  | "initialDomain"
  | "initialProjectId"
>;

export function useNewIssueForm(props: HookInput) {
  const {
    open,
    onOpenChange,
    action,
    projectActions,
    onTaskCreated,
    writeToClipboard = defaultWriteToClipboard,
    onToast = defaultToast,
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
    initialProjectId,
  } = props;

  const mode = resolveMode(action);
  const palette = PALETTE[mode];

  const { activeProjectId } = useProjectFilter();
  const { data: projects = [] } = useProjects();

  // Derived needs realProjects/scopedProject/phases first to seed State's
  // initial values; but State needs setters that Derived consumes. The
  // monolith resolved this with a single hook body; the split version
  // computes the same projections inline before instantiating the state
  // slice, mirroring the original computation order.
  //
  // We start by computing the *bare* realProjects/scopedProject/phases
  // using a tiny scratch projection, then pass them as seed inputs to
  // the state slice. The Derived slice re-computes them again so the
  // memoization stays inside React (state slice only uses them once for
  // initial useState() values).

  const seedRealProjects = projects.filter(
    (p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID,
  );
  const seedScopedProject = initialProjectId
    ? undefined
    : activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_ID
      ? seedRealProjects.find((p) => p.id === activeProjectId)
      : undefined;
  const seedPhases = projectActions?.phases ?? [];

  const state = useNewIssueFormState({
    open,
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
    initialProjectId,
    scopedProject: seedScopedProject,
    realProjects: seedRealProjects,
    phases: seedPhases,
    projectActions,
  });

  // Local impl for onParamEnableToggle. Uses functional setState (prev =>
  // next) to match the monolith's race-safety: snapshot-based closures
  // would drop updates when toggles fire rapidly (Step 3.7 external code
  // review OpenAI #2). Sensitive-clear must read the latest state, not the
  // render-time snapshot.
  const onParamEnableToggleImpl = useCallback(
    (s: RenderableParamSchema) => {
      state.setParamEnabled((prev) => {
        const wasEnabled = !!prev[s.name];
        const next = !wasEnabled;
        if (!next && s.sensitive) {
          state.setParamValues((vs) => {
            if (vs[s.name] === undefined) return vs;
            const copy = { ...vs };
            delete copy[s.name];
            return copy;
          });
          state.setRevealedSecrets((rs) => {
            if (rs[s.name] === undefined) return rs;
            const copy = { ...rs };
            delete copy[s.name];
            return copy;
          });
        } else if (next && !s.sensitive) {
          state.setParamValues((vs) => {
            const cur = vs[s.name];
            const empty =
              cur === undefined ||
              (typeof cur === "string" && cur.trim() === "");
            if (
              empty &&
              (s.type === "string" || s.type === "enum") &&
              typeof s.default === "string"
            ) {
              return { ...vs, [s.name]: s.default };
            }
            return vs;
          });
        }
        return { ...prev, [s.name]: next };
      });
    },
    [state],
  );

  const derived = useNewIssueFormDerived({
    open,
    mode,
    action,
    projects,
    activeProjectId,
    projectActions,
    initialProjectId,
    title: state.title,
    selectedProjectId: state.selectedProjectId,
    phaseId: state.phaseId,
    phaseOverridden: state.phaseOverridden,
    paramValues: state.paramValues,
    paramEnabled: state.paramEnabled,
    submitting: state.submitting,
    setPhaseId: state.setPhaseId,
    setDetectedTrigger: state.setDetectedTrigger,
    setParamValues: state.setParamValues,
    setParamEnabled: state.setParamEnabled,
    setRevealedSecrets: state.setRevealedSecrets,
    onParamEnableToggleImpl,
  });

  const { onSubmit } = useNewIssueFormSubmit({
    mode,
    action,
    title: state.title,
    description: state.description,
    autonomy: state.autonomy,
    leadDomain: state.leadDomain,
    leadPriority: state.leadPriority,
    leadComplexityHint: state.leadComplexityHint,
    leadTagsRaw: state.leadTagsRaw,
    leadBlockedByRaw: state.leadBlockedByRaw,
    paramValues: state.paramValues,
    paramEnabled: state.paramEnabled,
    canSubmit: derived.canSubmit,
    selectedProject: derived.selectedProject,
    currentPhase: derived.currentPhase,
    currentSchema: derived.currentSchema,
    showAutonomyToggle: derived.showAutonomyToggle,
    showLeadDomain: derived.showLeadDomain,
    showLeadPriority: derived.showLeadPriority,
    showLeadComplexityHint: derived.showLeadComplexityHint,
    showLeadTags: derived.showLeadTags,
    showLeadBlockedBy: derived.showLeadBlockedBy,
    setSubmitting: state.setSubmitting,
    setError: state.setError,
    onOpenChange,
    onTaskCreated,
    onToast,
    writeToClipboard,
  });

  return {
    // Identity
    mode,
    palette,
    // State (values + setters)
    ...state,
    // Derived (projections + flags + onParamEnableToggle)
    ...derived,
    // Handlers
    onSubmit,
  };
}

export type UseNewIssueFormReturn = ReturnType<typeof useNewIssueForm>;

async function defaultWriteToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function defaultToast(_msg: string, _sev: "info" | "error"): void {
  // No-op default. Tests inject a spy; the host page should pass a real
  // toaster when one exists.
}
