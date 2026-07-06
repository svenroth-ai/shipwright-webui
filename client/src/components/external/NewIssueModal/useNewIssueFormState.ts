/*
 * Form state slice for useNewIssueForm.
 *
 * Owns every `useState` for the modal + the reset-on-open effect.
 * `useNewIssueFormDerived` reads this slice's getters; `useNewIssueFormSubmit`
 * reads the values to build the request body.
 *
 * The reset-ref pattern (resetCtxRef) is preserved verbatim from the
 * pre-split monolith: background React-Query refetches produce new array
 * references with identical content — reacting to those wipes user input
 * mid-edit. Reading derived inputs through a ref keeps the effect deps
 * minimal (`[open]` only).
 */

import { useEffect, useRef, useState } from "react";

import type { AutonomyValue } from "../AutonomyToggle";
import type { Project } from "../../../types";
import type { PhaseDefinition, ResolvedProjectActions } from "../../../lib/externalApi";

export interface UseNewIssueFormStateInput {
  open: boolean;
  initialTitle?: string;
  initialDescription?: string;
  initialPhaseId?: string;
  initialPriority?: "P0" | "P1" | "P2" | "P3";
  initialDomain?: string;
  initialProjectId?: string;
  scopedProject: Project | undefined;
  realProjects: Project[];
  phases: PhaseDefinition[];
  projectActions: ResolvedProjectActions | undefined;
}

export function useNewIssueFormState(input: UseNewIssueFormStateInput) {
  const {
    open,
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
    initialProjectId,
    scopedProject,
    realProjects,
    phases,
    projectActions,
  } = input;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId ?? scopedProject?.id ?? realProjects[0]?.id ?? "",
  );
  const [autonomy, setAutonomy] = useState<AutonomyValue>(
    projectActions?.defaults.autonomy ?? "guided",
  );
  const [phaseId, setPhaseId] = useState<string>(phases[0]?.id ?? "");
  const [phaseOverridden, setPhaseOverridden] = useState(false);
  const [detectedTrigger, setDetectedTrigger] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Collapsed-by-default "More options" section (everything below the
  // Description: metadata, params, command preview). Auto-expands when the
  // modal opens pre-seeded with advanced content (e.g. triage "Fix now"
  // carries priority/domain) so carried-over values aren't hidden.
  // iterate-2026-07-06-collapse-dialog-more-options.
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(
    Boolean(initialPriority || initialDomain),
  );
  const [paramValues, setParamValues] = useState<
    Record<string, string | boolean>
  >({});
  const [revealedSecrets, setRevealedSecrets] = useState<
    Record<string, boolean>
  >({});
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>(
    {},
  );

  // iterate-2026-05-14 lead-foundation-task-schema — leadwright Phase 1.
  const [leadDomain, setLeadDomain] = useState("");
  const [leadPriority, setLeadPriority] = useState<
    "" | "P0" | "P1" | "P2" | "P3"
  >("");
  const [leadComplexityHint, setLeadComplexityHint] = useState<
    "" | "small" | "medium" | "large"
  >("");
  const [leadTagsRaw, setLeadTagsRaw] = useState("");
  const [leadBlockedByRaw, setLeadBlockedByRaw] = useState("");

  // Reset-effect ref pattern (v0.3.0 fix). Read derived inputs through
  // the ref so background refetches don't re-arm the reset effect.
  const resetCtxRef = useRef<{
    autonomy: AutonomyValue;
    firstPhaseId: string;
    seedProjectId: string;
    initialTitle?: string;
    initialDescription?: string;
    initialPhaseId?: string;
    initialPriority?: "P0" | "P1" | "P2" | "P3";
    initialDomain?: string;
  }>({
    autonomy: projectActions?.defaults.autonomy ?? "guided",
    firstPhaseId: phases[0]?.id ?? "",
    seedProjectId:
      initialProjectId ?? scopedProject?.id ?? realProjects[0]?.id ?? "",
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
  });
  resetCtxRef.current = {
    autonomy: projectActions?.defaults.autonomy ?? "guided",
    firstPhaseId: phases[0]?.id ?? "",
    seedProjectId:
      initialProjectId ?? scopedProject?.id ?? realProjects[0]?.id ?? "",
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
  };

  useEffect(() => {
    if (!open) return;
    const ctx = resetCtxRef.current;
    setTitle(ctx.initialTitle ?? "");
    setDescription(ctx.initialDescription ?? "");
    setError(null);
    setPhaseOverridden(Boolean(ctx.initialPhaseId));
    setDetectedTrigger(null);
    setAutonomy(ctx.autonomy);
    setPhaseId(ctx.initialPhaseId ?? ctx.firstPhaseId);
    setSelectedProjectId(ctx.seedProjectId);
    setAdvancedOpen(false);
    setMoreOptionsOpen(Boolean(ctx.initialPriority || ctx.initialDomain));
    setParamValues({});
    setRevealedSecrets({});
    setParamEnabled({});
    setLeadDomain(ctx.initialDomain ?? "");
    setLeadPriority(ctx.initialPriority ?? "");
    setLeadComplexityHint("");
    setLeadTagsRaw("");
    setLeadBlockedByRaw("");
  }, [open]);

  return {
    title,
    setTitle,
    description,
    setDescription,
    selectedProjectId,
    setSelectedProjectId,
    autonomy,
    setAutonomy,
    phaseId,
    setPhaseId,
    phaseOverridden,
    setPhaseOverridden,
    detectedTrigger,
    setDetectedTrigger,
    submitting,
    setSubmitting,
    error,
    setError,
    advancedOpen,
    setAdvancedOpen,
    moreOptionsOpen,
    setMoreOptionsOpen,
    paramValues,
    setParamValues,
    revealedSecrets,
    setRevealedSecrets,
    paramEnabled,
    setParamEnabled,
    leadDomain,
    setLeadDomain,
    leadPriority,
    setLeadPriority,
    leadComplexityHint,
    setLeadComplexityHint,
    leadTagsRaw,
    setLeadTagsRaw,
    leadBlockedByRaw,
    setLeadBlockedByRaw,
  };
}

export type UseNewIssueFormStateReturn = ReturnType<typeof useNewIssueFormState>;
