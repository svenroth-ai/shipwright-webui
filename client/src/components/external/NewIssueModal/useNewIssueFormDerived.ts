/*
 * Derived-value slice for useNewIssueForm.
 *
 * Pure projections from props + form state. Also owns the two non-submit
 * effects:
 *   - Schema-seed-on-open (paramValues/paramEnabled when open or schemaKey
 *     changes).
 *   - Debounced classifyPhase (task mode, title-driven, with clearTimeout
 *     cleanup so a close-during-debounce drops the stale completion).
 *
 * The submit slice consumes `currentSchema`, `currentPhase`, `selectedProject`,
 * `canSubmit`, `showAutonomyToggle`, `showLead*` from here.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { classifyPhase } from "../../../lib/classifyPhase";
import { UNASSIGNED_PROJECT_ID } from "../../../lib/projectIds";
import type {
  ActionDefinition,
  PhaseDefinition,
  ResolvedProjectActions,
} from "../../../lib/externalApi";
import type { RenderableParamSchema } from "../../../types/action-schema";
import type { Project } from "../../../types";

import type { Mode } from "./types";

export interface UseNewIssueFormDerivedInput {
  open: boolean;
  mode: Mode;
  action: ActionDefinition | null;
  projects: Project[];
  activeProjectId: string | null;
  projectActions: ResolvedProjectActions | undefined;
  initialProjectId?: string;
  // From state slice
  title: string;
  selectedProjectId: string;
  phaseId: string;
  phaseOverridden: boolean;
  paramValues: Record<string, string | boolean>;
  paramEnabled: Record<string, boolean>;
  submitting: boolean;
  setPhaseId: (id: string) => void;
  setDetectedTrigger: (s: string | null) => void;
  setParamValues: (v: Record<string, string | boolean>) => void;
  setParamEnabled: (v: Record<string, boolean>) => void;
  setRevealedSecrets: (v: Record<string, boolean>) => void;
  onParamEnableToggleImpl: (s: RenderableParamSchema) => void;
}

const PHASE_DEBOUNCE_MS = 250;

export function useNewIssueFormDerived(input: UseNewIssueFormDerivedInput) {
  const {
    open,
    mode,
    action,
    projects,
    activeProjectId,
    projectActions,
    initialProjectId,
    title,
    selectedProjectId,
    phaseId,
    phaseOverridden,
    paramValues,
    submitting,
    setPhaseId,
    setDetectedTrigger,
    setParamValues,
    setParamEnabled,
    setRevealedSecrets,
  } = input;

  const realProjects = useMemo(
    () =>
      projects.filter(
        (p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID,
      ),
    [projects],
  );
  const scopedProject: Project | undefined = useMemo(() => {
    if (initialProjectId) return undefined;
    if (!activeProjectId || activeProjectId === UNASSIGNED_PROJECT_ID)
      return undefined;
    return realProjects.find((p) => p.id === activeProjectId);
  }, [initialProjectId, activeProjectId, realProjects]);

  const phases: PhaseDefinition[] = useMemo(() => {
    const all = projectActions?.phases ?? [];
    const targetId =
      scopedProject?.id ?? selectedProjectId ?? realProjects[0]?.id;
    const target = realProjects.find((p) => p.id === targetId);
    if (target?.adopted === true) {
      return all.filter((p) => p.id !== "adopt");
    }
    return all;
  }, [projectActions, scopedProject, selectedProjectId, realProjects]);

  const currentSchema = useMemo<RenderableParamSchema[]>(() => {
    if (!action) return [];
    if (action.phase_parameters) {
      return action.phase_parameters[phaseId] ?? [];
    }
    return action.parameters ?? [];
  }, [action, phaseId]);

  const schemaKey = useMemo(
    () => currentSchema.map((s) => s.name).join("|"),
    [currentSchema],
  );

  // Stable ref for the schema-seed effect — see comment in monolith line
  // 442-468 (v0.3.0 review-fix).
  const currentSchemaRef = useRef<RenderableParamSchema[]>(currentSchema);
  currentSchemaRef.current = currentSchema;

  useEffect(() => {
    if (!open) return;
    const nextEnabled: Record<string, boolean> = {};
    const nextValues: Record<string, string | boolean> = {};
    for (const s of currentSchemaRef.current) {
      if (s.required) {
        nextEnabled[s.name] = true;
        if (
          (s.type === "string" || s.type === "enum") &&
          typeof s.default === "string"
        ) {
          nextValues[s.name] = s.default;
        }
      } else {
        nextEnabled[s.name] = false;
      }
    }
    setParamValues(nextValues);
    setParamEnabled(nextEnabled);
    setRevealedSecrets({});
  }, [
    open,
    schemaKey,
    setParamValues,
    setParamEnabled,
    setRevealedSecrets,
  ]);

  // Debounced phase classification — clearTimeout cleanup handles
  // close-during-debounce + rapid-input races.
  useEffect(() => {
    if (mode !== "new-task" || phaseOverridden || phases.length === 0) return;
    const handle = setTimeout(() => {
      const phaseIds = phases.map((p) => p.id);
      const guess = classifyPhase(title, phaseIds) ?? phaseIds[0] ?? "";
      setPhaseId(guess);
      const firstWord = title.trim().split(/\s+/)[0] ?? "";
      setDetectedTrigger(firstWord || null);
    }, PHASE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [title, phases, phaseOverridden, mode, setPhaseId, setDetectedTrigger]);

  const effectiveProjectId =
    scopedProject?.id ?? selectedProjectId ?? realProjects[0]?.id ?? "";

  const requiredMissing = useMemo(() => {
    return currentSchema.some((s) => {
      if (!s.required) return false;
      const v = paramValues[s.name];
      if (s.type === "boolean") return v !== true;
      if (typeof v === "string") return v.trim() === "";
      return v === undefined;
    });
  }, [currentSchema, paramValues]);

  const requiredFields = useMemo(
    () => currentSchema.filter((s) => s.required),
    [currentSchema],
  );
  const advancedFields = useMemo(
    () => currentSchema.filter((s) => !s.required),
    [currentSchema],
  );

  const selectedProject = useMemo<Project | undefined>(
    () => realProjects.find((p) => p.id === effectiveProjectId),
    [realProjects, effectiveProjectId],
  );

  const currentPhase = useMemo<PhaseDefinition | undefined>(
    () => phases.find((p) => p.id === phaseId) ?? phases[0],
    [phases, phaseId],
  );

  const catalogReady = Boolean(projectActions);
  const taskPhaseReady = mode !== "new-task" || Boolean(currentPhase);
  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    Boolean(effectiveProjectId) &&
    !requiredMissing &&
    catalogReady &&
    taskPhaseReady;

  const showAutonomyToggle =
    mode === "new-pipeline" ||
    mode === "new-iterate" ||
    (mode === "new-task" && currentPhase?.supports_autonomy === true);

  const showLeadDomain = action?.modal_fields?.includes("domain") ?? false;
  const showLeadPriority = action?.modal_fields?.includes("priority") ?? false;
  const showLeadComplexityHint =
    action?.modal_fields?.includes("complexityHint") ?? false;
  const showLeadTags = action?.modal_fields?.includes("tags") ?? false;
  const showLeadBlockedBy =
    action?.modal_fields?.includes("blockedBy") ?? false;

  // onParamEnableToggle — the body component dispatches; we close over
  // the state setters so the body's signature stays simple.
  const onParamEnableToggle = useCallback(
    (s: RenderableParamSchema) => {
      // Closure-only setter wraps; the actual mutation lives in
      // useNewIssueForm.ts which composes this hook (avoids importing the
      // state slice's setState here).
      input.onParamEnableToggleImpl(s);
    },
    [input],
  );

  return {
    realProjects,
    scopedProject,
    phases,
    currentSchema,
    schemaKey,
    effectiveProjectId,
    requiredMissing,
    requiredFields,
    advancedFields,
    selectedProject,
    currentPhase,
    canSubmit,
    showAutonomyToggle,
    showLeadDomain,
    showLeadPriority,
    showLeadComplexityHint,
    showLeadTags,
    showLeadBlockedBy,
    onParamEnableToggle,
  };
}

export type UseNewIssueFormDerivedReturn = ReturnType<
  typeof useNewIssueFormDerived
>;
