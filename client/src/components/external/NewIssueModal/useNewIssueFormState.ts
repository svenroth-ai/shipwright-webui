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
import type { RuntimeValue } from "../RuntimeToggle";
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
  /**
   * Codex Light §3.5 — the GLOBAL `settings.runtimeDefault` (renamed from
   * `codexRuntimeDefault`, Codextender integration Part B.1), seeding
   * RuntimeToggle's on-open value. Deliberately NOT per-project (unlike
   * `autonomy`, seeded from `projectActions?.defaults.autonomy`) — Goal 1
   * is one switch for everything. Only meaningful when `runtimeAvailability
   * === "both"` — see that field below.
   *
   * Local PR-review preflight finding (2026-09-16): a modal already open
   * when this value's query resolves used to never re-seed — the same race
   * `autonomy`'s seed had. Fixed for both together below (an untouched
   * field re-seeds when its default resolves; a user's explicit choice
   * never gets overwritten), since the two toggles deliberately mirror
   * each other (§3.5).
   */
  runtimeDefault?: RuntimeValue;
  /**
   * Codextender integration Part B.1 — the GLOBAL `settings.codexAvailability`.
   * When not "both" there is no per-task choice: the seeded/reseeded
   * `runtime` value is forced to the one allowed runtime, ignoring
   * `runtimeDefault` entirely (there is nothing left for it to seed).
   */
  runtimeAvailability?: "both" | "claude_only" | "codex_only";
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
    runtimeDefault,
    runtimeAvailability = "both",
  } = input;

  // Codextender integration Part B.1 — with no per-task choice
  // ("claude_only"/"codex_only"), the seeded runtime is the one allowed
  // value, not whatever the operator left in `runtimeDefault`.
  const resolveSeedRuntime = (): RuntimeValue => {
    if (runtimeAvailability === "claude_only") return "claude";
    if (runtimeAvailability === "codex_only") return "codex";
    return runtimeDefault === "codex" ? "codex" : "claude";
  };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId ?? scopedProject?.id ?? realProjects[0]?.id ?? "",
  );
  const [autonomy, setAutonomy] = useState<AutonomyValue>(
    projectActions?.defaults.autonomy ?? "guided",
  );
  const [runtime, setRuntime] = useState<RuntimeValue>(
    resolveSeedRuntime(),
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
    runtime: RuntimeValue;
    firstPhaseId: string;
    seedProjectId: string;
    initialTitle?: string;
    initialDescription?: string;
    initialPhaseId?: string;
    initialPriority?: "P0" | "P1" | "P2" | "P3";
    initialDomain?: string;
  }>({
    autonomy: projectActions?.defaults.autonomy ?? "guided",
    runtime: resolveSeedRuntime(),
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
    runtime: resolveSeedRuntime(),
    firstPhaseId: phases[0]?.id ?? "",
    seedProjectId:
      initialProjectId ?? scopedProject?.id ?? realProjects[0]?.id ?? "",
    initialTitle,
    initialDescription,
    initialPhaseId,
    initialPriority,
    initialDomain,
  };

  // Local PR-review preflight finding — an untouched autonomy/runtime field
  // re-seeds if its default resolves AFTER the modal is already open; a
  // user's explicit choice (via the wrapped setters below) is never
  // overwritten. Reset to untouched on every open, alongside the rest of
  // the form.
  const autonomyTouchedRef = useRef(false);
  const runtimeTouchedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const ctx = resetCtxRef.current;
    setTitle(ctx.initialTitle ?? "");
    setDescription(ctx.initialDescription ?? "");
    setError(null);
    setPhaseOverridden(Boolean(ctx.initialPhaseId));
    setDetectedTrigger(null);
    setAutonomy(ctx.autonomy);
    setRuntime(ctx.runtime);
    autonomyTouchedRef.current = false;
    runtimeTouchedRef.current = false;
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

  // Re-seed an untouched field once its default resolves after open (the
  // race the preflight finding names). Deliberately separate from the
  // reset effect above: this one reacts to the resolved defaults, not to
  // `open`, and must never re-arm on an unrelated background refetch that
  // happens to resolve to the SAME value (no-op setState, no visible flicker).
  useEffect(() => {
    if (!open) return;
    if (!autonomyTouchedRef.current) setAutonomy(resetCtxRef.current.autonomy);
  }, [open, projectActions?.defaults.autonomy]);

  useEffect(() => {
    if (!open) return;
    if (!runtimeTouchedRef.current) setRuntime(resetCtxRef.current.runtime);
  }, [open, runtimeDefault, runtimeAvailability]);

  // Exposed to consumers in place of the raw setState — marks the field
  // touched so the re-seed effects above never clobber a user's own choice.
  const setAutonomyTouched: typeof setAutonomy = (value) => {
    autonomyTouchedRef.current = true;
    setAutonomy(value);
  };
  const setRuntimeTouched: typeof setRuntime = (value) => {
    runtimeTouchedRef.current = true;
    setRuntime(value);
  };

  return {
    title,
    setTitle,
    description,
    setDescription,
    selectedProjectId,
    setSelectedProjectId,
    autonomy,
    setAutonomy: setAutonomyTouched,
    runtime,
    setRuntime: setRuntimeTouched,
    runtimeAvailability,
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
