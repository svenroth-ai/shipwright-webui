/*
 * Single modal; three render configurations keyed off the chosen action
 * (new-task / new-pipeline / new-iterate — all external_launch per AD-03.13).
 *
 * Iterate 3 section 03:
 *   - Consumes `useProjectFilter` to pick read-only context vs project dropdown.
 *   - Dual Save / Launch submit — Save goes to the Backlog (draft state), Launch
 *     creates + launches + copies to clipboard (FR-03.90/91).
 *   - Task mode: debounced classifyPhase on the title (250 ms) with null-fallback
 *     to phases[0] (O23).
 *   - Pipeline + Iterate modes: AutonomyToggle; Task mode omits it (FR-03.72).
 *   - Helper-box body distinguishes Save vs Launch semantics.
 *   - Footer is the single-line `<kbd>Esc</kbd> to cancel` hint (FR-03.92).
 *   - NO priority field anywhere (FR-03.21 regression).
 *
 * Phase B2 — iterate 3 remediation (2026-04-20):
 *   - Per-mode palette (task=amber / pipeline=purple / iterate=emerald) applied
 *     to the modal icon tile, helper-box (bg + text + left-border), and the
 *     embedded CommandPreviewPanel's left stripe.
 *   - 34x34 rounded-8 icon tile in the header (CheckSquare / Workflow / RotateCw).
 *   - Pipeline mode is 580px wide; task + iterate are 540px.
 *   - Task-mode Phase field is a Radix DropdownMenu with a 10x10 rounded-3
 *     colored square per option (phase.color from actions.json). Auto-detect
 *     hint line has a dotted-underline `manually override` button.
 *   - Launch button gets a Bookmark icon before the label.
 *   - Live CommandPreviewPanel rendered in all three modes.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bookmark,
  CheckSquare,
  ChevronDown,
  RotateCw,
  Terminal,
  Workflow,
  X,
} from "lucide-react";

import {
  createTask,
  launchExternalTask,
  type ActionDefinition,
  type PhaseDefinition,
  type ResolvedProjectActions,
} from "../../lib/externalApi";
import { useProjectFilter } from "../../hooks/useProjectFilter";
import { useProjects } from "../../hooks/useProjects";
import { classifyPhase } from "../../lib/classifyPhase";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import { AutonomyToggle, type AutonomyValue } from "./AutonomyToggle";
import { ParamField } from "./ParamField";
import type { PreviewParam } from "./CommandPreviewPanel";
import type { RenderableParamSchema } from "../../types/action-schema";
import { ProjectContextStrip } from "./ProjectContextStrip";
import { CommandPreviewPanel } from "./CommandPreviewPanel";
import type { Project } from "../../types";

export interface NewIssueModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action the user picked (primary button or dropdown). Drives mode. */
  action: ActionDefinition | null;
  /** Resolved actions for the ACTIVE project (or the fallback when "All"). */
  projectActions: ResolvedProjectActions | undefined;
  /** Callback the page uses to invalidate the task list after Save/Launch. */
  onTaskCreated?: () => void;
  /** Injected for tests — default uses navigator.clipboard.writeText. */
  writeToClipboard?: (text: string) => Promise<void>;
  /** Injected for tests. Default is a no-op — Save-to-Backlog success is
   *  already visible to the user via the task appearing in the Draft
   *  column (onTaskCreated invalidates the query). The previous
   *  `window.alert` default was an iterate-3 regression (see
   *  `~/.claude/plans/iterate-3-remediation.md` BUG 1 / Phase A3). */
  onToast?: (msg: string, sev: "info" | "error") => void;
}

type SubmitAction = "save" | "launch";
type Mode = "new-task" | "new-pipeline" | "new-iterate" | "new-plain";

// 250 ms matches the mockup + O23 default in the section spec.
const PHASE_DEBOUNCE_MS = 250;

// Per-mode palette. Applied to the modal icon tile bg/fg, helper box
// bg/text/left-border, and the CommandPreviewPanel's left stripe.
// Sources tokens from index.css — hex fallbacks are dead-code safety nets
// for the rare case where a token isn't defined in the user's theme.
interface ModePalette {
  /** bg for 34x34 icon tile + helper box body */
  bg: string;
  /** fg for the icon glyph + helper text */
  text: string;
  /** strong/label color in the helper body */
  textStrong: string;
  /** stripe color for helper box left border + command-preview left stripe */
  stripe: string;
}

const PALETTE: Record<Mode, ModePalette> = {
  "new-task": {
    bg: "var(--color-warning-bg, #FEF3C7)",
    text: "var(--color-warning-text, #92400E)",
    textStrong: "#78350F",
    stripe: "var(--color-warning, #D97706)",
  },
  "new-pipeline": {
    bg: "var(--color-purple-bg, #F3E8FF)",
    text: "var(--color-purple-text, #6B21A8)",
    textStrong: "#4c1d95",
    stripe: "var(--color-purple, #8B5CF6)",
  },
  "new-iterate": {
    bg: "var(--color-success-bg, #D1FAE5)",
    text: "var(--color-success-text, #065F46)",
    textStrong: "#064e3b",
    stripe: "var(--color-success, #059669)",
  },
  // v0.4.0 — Plain Claude (no skill, no pipeline). Slate palette
  // distinguishes it from the three Shipwright modes without competing
  // visually.
  "new-plain": {
    bg: "var(--color-muted-bg, #ede8e1)",
    text: "var(--color-muted, #6b7280)",
    textStrong: "#374151",
    stripe: "var(--color-accent, #857568)",
  },
};

function modeIcon(mode: Mode): ReactNode {
  if (mode === "new-pipeline") return <Workflow size={18} strokeWidth={1.6} />;
  if (mode === "new-iterate") return <RotateCw size={18} strokeWidth={1.7} />;
  if (mode === "new-plain") return <Terminal size={18} strokeWidth={1.8} />;
  return <CheckSquare size={18} strokeWidth={1.8} />;
}

export function NewIssueModal({
  open,
  onOpenChange,
  action,
  projectActions,
  onTaskCreated,
  writeToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
  },
  onToast = () => {
    // No-op default. Tests inject a spy; the host page should pass a
    // real toaster when one exists. See `~/.claude/plans/iterate-3-remediation.md`
    // BUG 1 — the prior `window.alert` default blocked automation and was
    // hostile UX.
  },
}: NewIssueModalProps) {
  const navigate = useNavigate();
  const { activeProjectId } = useProjectFilter();
  const { data: projects = [] } = useProjects();

  const mode: Mode =
    action?.id === "new-pipeline"
      ? "new-pipeline"
      : action?.id === "new-iterate"
        ? "new-iterate"
        : action?.id === "new-plain"
          ? "new-plain"
          : "new-task";
  const palette = PALETTE[mode];

  const realProjects = useMemo(
    () => projects.filter((p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID),
    [projects],
  );
  const scopedProject: Project | undefined = useMemo(() => {
    if (!activeProjectId || activeProjectId === UNASSIGNED_PROJECT_ID) return undefined;
    return realProjects.find((p) => p.id === activeProjectId);
  }, [activeProjectId, realProjects]);

  // Controlled form state, reset on modal open.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    scopedProject?.id ?? realProjects[0]?.id ?? "",
  );
  const [autonomy, setAutonomy] = useState<AutonomyValue>(
    projectActions?.defaults.autonomy ?? "guided",
  );
  // `adopt` is a one-shot phase (brownfield onboarding). Once a project
  // has a shipwright_run_config.json the server reports `adopted: true`;
  // we hide the option so users can't re-trigger it. Legacy API shapes
  // that omit the field render as "not adopted" — the skill's own
  // pre-flight check will still refuse re-adoption, so the UI stays
  // recoverable.
  const phases: PhaseDefinition[] = useMemo(() => {
    const all = projectActions?.phases ?? [];
    const targetId = scopedProject?.id ?? selectedProjectId ?? realProjects[0]?.id;
    const target = realProjects.find((p) => p.id === targetId);
    if (target?.adopted === true) {
      return all.filter((p) => p.id !== "adopt");
    }
    return all;
  }, [projectActions, scopedProject, selectedProjectId, realProjects]);
  const [phaseId, setPhaseId] = useState<string>(phases[0]?.id ?? "");
  const [phaseOverridden, setPhaseOverridden] = useState(false);
  const [detectedTrigger, setDetectedTrigger] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // iterate/launch-cli-parameters § 4 — schema-driven Advanced parameters.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string | boolean>>({});
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  // iterate/v030-five-ux-fixes (P1) — explicit per-field enable state.
  // Required fields are hardcoded `true`; optional string/enum fields
  // start `false` (opt-in) and toggle via the enable-checkbox.
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>({});

  // iterate/v030-five-ux-fixes (review M5 / regression guard) — the
  // reset-form effect must fire ONLY when the modal opens (false → true),
  // NOT every time projectActions / phases / scopedProject identity
  // changes. Background React-Query refetches produce new array
  // references with identical content; reacting to those wipes user
  // input mid-edit. Read all derived inputs through refs so the closure
  // sees the latest value without triggering re-runs.
  const resetCtxRef = useRef<{
    autonomy: AutonomyValue;
    firstPhaseId: string;
    initialProjectId: string;
  }>({
    autonomy: projectActions?.defaults.autonomy ?? "guided",
    firstPhaseId: phases[0]?.id ?? "",
    initialProjectId: scopedProject?.id ?? realProjects[0]?.id ?? "",
  });
  resetCtxRef.current = {
    autonomy: projectActions?.defaults.autonomy ?? "guided",
    firstPhaseId: phases[0]?.id ?? "",
    initialProjectId: scopedProject?.id ?? realProjects[0]?.id ?? "",
  };

  useEffect(() => {
    if (!open) return;
    const ctx = resetCtxRef.current;
    setTitle("");
    setDescription("");
    setError(null);
    setPhaseOverridden(false);
    setDetectedTrigger(null);
    setAutonomy(ctx.autonomy);
    setPhaseId(ctx.firstPhaseId);
    setSelectedProjectId(ctx.initialProjectId);
    // iterate/launch-cli-parameters § 4 — full reset of Advanced state.
    setAdvancedOpen(false);
    setParamValues({});
    setRevealedSecrets({});
    setParamEnabled({});
  }, [open]);

  // iterate/launch-cli-parameters § 4 — Schema-Lookup. Switch on the
  // *shape* of the action (does it expose phase_parameters?) rather than
  // the mode string — keeps the lookup correct if a future non-task
  // action gains phase-bound parameters (external review O4).
  const currentSchema = useMemo<RenderableParamSchema[]>(() => {
    if (!action) return [];
    if (action.phase_parameters) {
      return action.phase_parameters[phaseId] ?? [];
    }
    return action.parameters ?? [];
  }, [action, phaseId]);

  // iterate/fix-adopt-prompt-shape — opt-in semantics (Bug 3): defaults
  // are NOT pre-filled. Strings + booleans + enums all start empty/
  // unchecked/Select-please. Defaults appear as placeholder text in
  // ParamField, so the user sees them as hints but must explicitly opt
  // in to emit. The server no longer auto-injects defaults either —
  // both layers agree on the opt-in contract (except for required
  // fields, where the server falls back to the schema default).
  //
  // Stable dependency key (review fix OpenAI #5): `currentSchema`
  // identity changes on every render even when the schema is logically
  // the same. We hash the param names instead so unrelated rerenders
  // don't wipe user-entered values.
  const schemaKey = useMemo(
    () => currentSchema.map((s) => s.name).join("|"),
    [currentSchema],
  );
  // iterate/v030-five-ux-fixes (post-review fix) — keep `currentSchema`
  // out of the reset-effect deps. The seeding code reads it via ref so
  // a React-Query refetch that produces a new array reference with the
  // same param names doesn't blow away user-typed values. Only schemaKey
  // (stable hash of names) and `open` should trigger reset.
  const currentSchemaRef = useRef<RenderableParamSchema[]>(currentSchema);
  currentSchemaRef.current = currentSchema;
  useEffect(() => {
    if (!open) return;
    // iterate/v030-five-ux-fixes (P1) — seed required fields enabled,
    // optional fields off. For required+default schemas seed the value
    // with the default so submit-gate can pass without forcing the user
    // to retype the schema-default verbatim.
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
  }, [open, schemaKey]);

  // iterate/v030-five-ux-fixes (P1) — toggle handler keeps three slices
  // of state coherent: enable, value, revealedSecrets.
  // - Toggle ON  + value empty + non-sensitive default exists → pre-fill default.
  // - Toggle OFF + sensitive   → clear value + revealedSecret entry.
  // - Toggle OFF + non-sensitive → keep value (re-toggle preserves user input).
  const onParamEnableToggle = useCallback(
    (s: RenderableParamSchema) => {
      setParamEnabled((prev) => {
        const wasEnabled = !!prev[s.name];
        const next = !wasEnabled;
        if (!next && s.sensitive) {
          setParamValues((vs) => {
            if (vs[s.name] === undefined) return vs;
            const copy = { ...vs };
            delete copy[s.name];
            return copy;
          });
          setRevealedSecrets((rs) => {
            if (rs[s.name] === undefined) return rs;
            const copy = { ...rs };
            delete copy[s.name];
            return copy;
          });
        } else if (next && !s.sensitive) {
          setParamValues((vs) => {
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
    [],
  );

  // Debounced phase classification — only when Task mode and user hasn't overridden.
  useEffect(() => {
    if (mode !== "new-task" || phaseOverridden || phases.length === 0) return;
    const handle = setTimeout(() => {
      const phaseIds = phases.map((p) => p.id);
      const guess = classifyPhase(title, phaseIds) ?? phaseIds[0] ?? "";
      setPhaseId(guess);
      // Extract the keyword that triggered the match (first word in title
      // that resonated). We re-parse via classifyPhase semantics — a cheap
      // heuristic: the first word of the title is close enough and mirrors
      // the mockup's `"<trigger>" → <phase>` hint.
      const firstWord = title.trim().split(/\s+/)[0] ?? "";
      setDetectedTrigger(firstWord || null);
    }, PHASE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [title, phases, phaseOverridden, mode]);

  const effectiveProjectId =
    scopedProject?.id ?? selectedProjectId ?? realProjects[0]?.id ?? "";

  // iterate/launch-cli-parameters § 4 — Required-validation. A required
  // string/enum is "filled" when value is a non-empty string; required
  // boolean is "filled" when value === true (rare, but possible — note
  // the validator now rejects boolean+required at load time, so this
  // branch is defensive).
  const requiredMissing = useMemo(() => {
    return currentSchema.some((s) => {
      if (!s.required) return false;
      const v = paramValues[s.name];
      if (s.type === "boolean") return v !== true;
      if (typeof v === "string") return v.trim() === "";
      return v === undefined;
    });
  }, [currentSchema, paramValues]);

  // iterate/v030-five-ux-fixes (P2) — required fields render OUTSIDE the
  // Advanced collapsible. Generic over `required: true` — currently only
  // `build.section` uses it but the layout adapts to any future required
  // params.
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

  // v0.4.1 — gate submit on the actions catalog being loaded. Before the
  // fix, fast typists could click Launch & Copy before useProjectActions
  // resolved → the modal had `phases = []` → `currentPhase = undefined` →
  // `body.phase` not sent → server persisted task without phase, and
  // TaskDetailHeader's title-keyword fallback then mis-classified
  // "WebUI Repo Adopten" as Design (Sven 2026-04-25). Submitting without
  // a resolved phase in task mode is now prevented entirely.
  const catalogReady = Boolean(projectActions);
  const taskPhaseReady = mode !== "new-task" || Boolean(currentPhase);
  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    Boolean(effectiveProjectId) &&
    !requiredMissing &&
    catalogReady &&
    taskPhaseReady;

  // iterate/v030-five-ux-fixes (P3) — phase-aware AutonomyToggle in task
  // mode. Pipeline + Iterate keep the toggle unconditionally (they're
  // action-driven, not phase-driven). Task mode shows it ONLY when the
  // current phase declares supports_autonomy: true.
  const showAutonomyToggle =
    mode === "new-pipeline" ||
    mode === "new-iterate" ||
    (mode === "new-task" && currentPhase?.supports_autonomy === true);

  const onSubmit = useCallback(
    async (ev: FormEvent, submitAction: SubmitAction) => {
      ev.preventDefault();
      if (!canSubmit || !selectedProject) return;
      setSubmitting(true);
      setError(null);
      try {
        // 2026-04-23 — iterate-20260423-chat-livetest-2 AC-B. Pass the
        // selected phase on CREATE (not just on /launch) so Save-to-Backlog
        // tasks get the badge too. Server validates against the catalog
        // and derives phaseLabel — we send id only.
        const createPayload: {
          title: string;
          cwd: string;
          pluginDirs: string[];
          projectId: string;
          phase?: string;
        } = {
          title: title.trim(),
          cwd: selectedProject.path,
          pluginDirs: [],
          projectId: selectedProject.id,
        };
        if (mode === "new-task" && currentPhase) {
          createPayload.phase = currentPhase.id;
        }
        const task = await createTask(createPayload);

        if (submitAction === "save") {
          onTaskCreated?.();
          onOpenChange(false);
          onToast("Saved to Backlog", "info");
          return;
        }

        // Launch path — server transitions state first, then clipboard.
        // 2026-04-23 — pass the full action context (actionId + phase +
        // phaseLabel + description + autonomy) so the server runs
        // substitutePlaceholders against the matching command_template
        // and persists the phase on the task for the TaskDetail badge.
        const body: {
          description?: string;
          autonomy?: AutonomyValue;
          actionId?:
            | "new-task"
            | "new-pipeline"
            | "new-iterate"
            | "new-plain";
          phase?: string;
          phaseLabel?: string;
          parameters?: Record<string, string | boolean>;
        } = {
          actionId: mode,
        };
        if (description.trim()) body.description = description.trim();
        // iterate/v030-five-ux-fixes (P3) — autonomy is sent only when
        // the toggle was actually rendered. For task mode that means the
        // current phase declared supports_autonomy: true; otherwise we
        // omit the field so the server (and substituter) don't emit
        // `--autonomous` for a phase where it has no effect.
        if (showAutonomyToggle) body.autonomy = autonomy;
        // Task mode sends the picked phase; Pipeline/Iterate have no phase.
        if (mode === "new-task" && currentPhase) {
          body.phase = currentPhase.id;
          body.phaseLabel = currentPhase.label;
        }
        // iterate/launch-cli-parameters § 5 — only send entries the user
        // explicitly enabled. Disabled or empty fields are dropped here
        // so the server doesn't see them.
        const explicit = explicitParamEntries(
          currentSchema,
          paramValues,
          paramEnabled,
        );
        if (Object.keys(explicit).length > 0) body.parameters = explicit;
        const { commands } = await launchExternalTask(task.taskId, body);
        onTaskCreated?.();

        // Platform-default clipboard choice: PowerShell on Windows, POSIX elsewhere.
        const isWin =
          typeof navigator !== "undefined" &&
          /win/i.test(navigator.userAgent || "");
        const copyText = isWin ? commands.powershell : commands.posix;
        try {
          await writeToClipboard(copyText);
        } catch {
          onToast(
            "Copy failed — open TaskDetail to copy manually.",
            "error",
          );
          // Do NOT unwind the task — server already committed.
        }
        onOpenChange(false);
        navigate(`/tasks/${task.taskId}`);
      } catch (err) {
        setError(String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [
      canSubmit,
      selectedProject,
      title,
      description,
      autonomy,
      mode,
      navigate,
      onOpenChange,
      onTaskCreated,
      onToast,
      writeToClipboard,
      currentPhase,
      currentSchema,
      paramValues,
      paramEnabled,
      showAutonomyToggle,
    ],
  );

  if (!action) return null;

  // Pipeline gets the wider layout (dense prose + segmented Autonomy row).
  const modalWidth = mode === "new-pipeline" ? "w-[580px]" : "w-[540px]";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={`fixed left-1/2 top-[10%] z-50 ${modalWidth} max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]`}
          data-testid={`new-issue-modal-${mode}`}
        >
          {/* Header: icon tile + title/subtitle + close */}
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              data-testid="new-issue-header-icon"
              className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: palette.bg, color: palette.text }}
              aria-hidden
            >
              {modeIcon(mode)}
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title
                className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]"
                style={{ letterSpacing: "-0.2px" }}
              >
                {modeHeading(mode)}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--color-muted,#6b7280)]">
                {modeSubheading(mode)}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="new-issue-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <form
            onSubmit={(e) => void onSubmit(e, "launch")}
            data-testid="new-issue-modal-form"
          >
            <div className="flex max-h-[calc(100vh-280px)] flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* Project context or selector */}
              {scopedProject ? (
                <ProjectContextStrip
                  name={scopedProject.name}
                  color={scopedProject.settings?.color}
                  path={scopedProject.path}
                />
              ) : (
                <FieldLabel label="Project" required>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    data-testid="new-issue-project-select"
                    className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-2 text-[13px]"
                    required
                  >
                    <option value="">Select project…</option>
                    {realProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              )}

              {/* Title */}
              <FieldLabel
                label="Title"
                required
                hint={mode === "new-task" ? "auto-detects phase" : undefined}
              >
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="new-issue-title-input"
                  placeholder="e.g. Fix login redirect bug"
                  className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
                  autoFocus
                  required
                />
              </FieldLabel>

              {/* Phase — Task mode only. Radix DropdownMenu with color-square per option. */}
              {mode === "new-task" && phases.length > 0 && (
                <FieldLabel
                  label="Phase"
                  hint="from this project's actions.json"
                >
                  <PhaseDropdown
                    phases={phases}
                    value={phaseId}
                    onChange={(id) => {
                      setPhaseId(id);
                      setPhaseOverridden(true);
                    }}
                  />
                  {/* Auto-detected hint line */}
                  {!phaseOverridden && currentPhase && (
                    <div
                      className="flex items-center gap-1.5 pl-0.5 text-[11px] text-[var(--color-muted,#6b7280)]"
                      data-testid="new-issue-phase-autohint"
                    >
                      <span>Auto-detected from title:</span>
                      <strong className="font-medium text-[var(--color-text,#1a1a1a)]">
                        {detectedTrigger
                          ? `"${detectedTrigger}" → ${currentPhase.label}`
                          : currentPhase.label}
                      </strong>
                      <span>.</span>
                      <button
                        type="button"
                        data-testid="new-issue-phase-override"
                        onClick={() => setPhaseOverridden(true)}
                        className="border-b border-dotted border-[var(--color-primary,#6b5e56)] text-[var(--color-primary,#6b5e56)]"
                      >
                        manually override
                      </button>
                    </div>
                  )}
                </FieldLabel>
              )}

              {/* Autonomy — Pipeline + Iterate always; Task mode only when
                  the current phase declares supports_autonomy: true (P3). */}
              {showAutonomyToggle && (
                <FieldLabel label="Autonomy">
                  <AutonomyToggle value={autonomy} onChange={setAutonomy} />
                </FieldLabel>
              )}

              {/* Description */}
              <FieldLabel
                label="Description"
                hint="optional — becomes the first prompt Claude sees"
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="new-issue-description-input"
                  placeholder="What needs to be done? Link files, paste errors, reference FRs…"
                  className="min-h-[108px] w-full resize-y rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
                />
              </FieldLabel>

              {/* iterate/v030-five-ux-fixes (P2) — Required parameters
                  rendered OUTSIDE the Advanced collapsible so the user
                  sees them immediately. The same <ParamField> renders;
                  required schemas force `enabled: true` via the badge
                  rather than an enable-checkbox. */}
              {requiredFields.length > 0 && (
                <div
                  data-testid="new-issue-required-section"
                  className="flex flex-col gap-3"
                >
                  {requiredFields.map((p) => {
                    const v = paramValues[p.name];
                    const empty =
                      (p.type === "boolean" && v !== true) ||
                      (p.type !== "boolean" &&
                        (typeof v !== "string" || v.trim() === ""));
                    return (
                      <ParamField
                        key={p.name}
                        schema={p}
                        value={v}
                        onChange={(next) =>
                          setParamValues((prev) => ({ ...prev, [p.name]: next }))
                        }
                        revealed={revealedSecrets[p.name] === true}
                        onRevealToggle={() =>
                          setRevealedSecrets((prev) => ({
                            ...prev,
                            [p.name]: !prev[p.name],
                          }))
                        }
                        enabled={true}
                        // No onEnableToggle for required — ParamField
                        // renders the "Required" badge instead.
                        showRequiredError={empty}
                      />
                    );
                  })}
                </div>
              )}

              {/* iterate/launch-cli-parameters § 4 — Advanced parameters
                  collapsible. Hides required fields (now in their own
                  section above per P2). The collapsible only renders if
                  there's at least one optional field. */}
              {advancedFields.length > 0 && (
                <div data-testid="new-issue-advanced-section">
                  <button
                    type="button"
                    data-testid="new-issue-advanced-toggle"
                    onClick={() => setAdvancedOpen((p) => !p)}
                    aria-expanded={advancedOpen}
                    className="flex w-full items-center justify-between rounded-[var(--radius-button,8px)] px-2 py-1.5 text-[12px] font-medium text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]"
                  >
                    <span>
                      Advanced parameters ({advancedFields.length})
                    </span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {advancedOpen && (
                    <div
                      data-testid="new-issue-advanced-content"
                      className="mt-2 flex flex-col gap-3 rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f9f6f3)] px-3 py-3"
                    >
                      {advancedFields.map((p) => {
                        const v = paramValues[p.name];
                        return (
                          <ParamField
                            key={p.name}
                            schema={p}
                            value={v}
                            onChange={(next) =>
                              setParamValues((prev) => ({ ...prev, [p.name]: next }))
                            }
                            revealed={revealedSecrets[p.name] === true}
                            onRevealToggle={() =>
                              setRevealedSecrets((prev) => ({
                                ...prev,
                                [p.name]: !prev[p.name],
                              }))
                            }
                            enabled={paramEnabled[p.name] === true}
                            onEnableToggle={() => onParamEnableToggle(p)}
                            showRequiredError={false}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Command preview — live-updated, debounced 250ms. */}
              <FieldLabel
                label="Command preview"
                hint={
                  mode === "new-task"
                    ? "phase drives the slash command · only used when you click Launch & Copy"
                    : "generated from .webui/actions.json · auto-updates"
                }
              >
                <CommandPreviewPanel
                  mode={mode}
                  title={title}
                  description={description}
                  projectPath={selectedProject?.path ?? ""}
                  sessionUuid="<session-uuid>"
                  // iterate/v030-five-ux-fixes (P3) — autonomy flows
                  // through whenever the toggle is rendered. Phase-aware
                  // task mode passes through too; phases without
                  // supports_autonomy pass undefined so the preview omits
                  // `--autonomous`.
                  autonomy={showAutonomyToggle ? autonomy : undefined}
                  phaseId={mode === "new-task" ? phaseId : undefined}
                  phaseLabel={
                    mode === "new-task" ? currentPhase?.label : undefined
                  }
                  parameters={paramsToPreview(
                    currentSchema,
                    paramValues,
                    paramEnabled,
                  )}
                />
              </FieldLabel>

              {/* Helper-box — per-mode palette. */}
              <div
                className="flex items-start gap-2 rounded-[var(--radius-button,8px)] px-3 py-2.5 text-[12px] leading-[1.55]"
                style={{
                  background: palette.bg,
                  color: palette.text,
                  borderLeft: `3px solid ${palette.stripe}`,
                }}
              >
                <div>
                  <strong
                    className="font-semibold"
                    style={{ color: palette.textStrong }}
                  >
                    Save to Backlog:
                  </strong>{" "}
                  command is <em>not</em> copied — task parks in the Backlog
                  column until you start it.
                  <br />
                  <strong
                    className="font-semibold"
                    style={{ color: palette.textStrong }}
                  >
                    Launch:
                  </strong>{" "}
                  command is copied to your clipboard + task moves to In
                  Progress + TaskDetail opens. Paste in your terminal; webui
                  follows the JSONL from there.
                </div>
              </div>

              {error && (
                <div
                  data-testid="new-issue-error"
                  className="text-[12px] text-[var(--color-error,#DC2626)]"
                >
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
              <div
                className="flex-1 text-[11px] text-[var(--color-muted,#6b7280)]"
                data-testid="new-issue-footer-hint"
              >
                <kbd className="rounded-[3px] border border-[var(--color-border,#e0dbd4)] bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  Esc
                </kbd>{" "}
                to cancel
              </div>
              <button
                type="button"
                data-testid="new-issue-save-btn"
                onClick={(e) => void onSubmit(e, "save")}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Bookmark size={14} className="text-[var(--color-accent,#857568)]" strokeWidth={1.6} />
                Save to Backlog
              </button>
              <button
                type="submit"
                data-testid="new-issue-launch-btn"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Launch & Copy
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Radix DropdownMenu wrapping the Phase field in task mode. Each item
 * gets a 10x10 rounded-3 colored square (from phase.color) + label. The
 * trigger is styled to match `.phase-select-btn` from the mockup.
 */
function PhaseDropdown({
  phases,
  value,
  onChange,
}: {
  phases: PhaseDefinition[];
  value: string;
  onChange: (id: string) => void;
}) {
  const current = phases.find((p) => p.id === value) ?? phases[0];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="new-issue-phase-select"
          className="flex w-full items-center gap-2.5 rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-white px-3 py-2 text-[13px] text-[var(--color-text,#1a1a1a)] hover:border-[var(--color-primary,#6b5e56)]"
        >
          <span
            className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
            style={{ background: current?.color ?? "#9ca3af" }}
            aria-hidden
          />
          <span className="flex-1 text-left font-medium">{current?.label ?? "Select…"}</span>
          <ChevronDown size={12} className="text-[var(--color-muted,#6b7280)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          data-testid="new-issue-phase-menu"
          className="z-[60] min-w-[220px] rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-white p-1 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
        >
          {phases.map((p) => {
            const active = p.id === value;
            return (
              <DropdownMenu.Item
                key={p.id}
                data-testid={`new-issue-phase-option-${p.id}`}
                onSelect={() => onChange(p.id)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] text-[var(--color-text,#1a1a1a)] outline-none hover:bg-[var(--color-muted-bg,#ede8e1)] focus:bg-[var(--color-muted-bg,#ede8e1)] ${
                  active ? "font-medium" : ""
                }`}
              >
                <span
                  className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
                  style={{ background: p.color ?? "#9ca3af" }}
                  aria-hidden
                />
                <span className="flex-1">{p.label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function FieldLabel({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
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

function modeHeading(mode: Mode): string {
  if (mode === "new-pipeline") return "New Pipeline";
  if (mode === "new-iterate") return "New Iterate";
  if (mode === "new-plain") return "Plain Claude";
  return "New Task";
}

function modeSubheading(mode: Mode): string {
  if (mode === "new-pipeline")
    return "Full Shipwright SDLC. Save it to the Backlog, or Launch now to copy the command and start immediately.";
  if (mode === "new-iterate")
    return "Lightweight change on a completed project. Save it to the Backlog, or Launch now to copy the command and start immediately.";
  if (mode === "new-plain")
    return "Plain Claude session in this project's directory. No skill, no slash command — just a chat.";
  return "Standalone task scoped to a Shipwright phase. Save it to the Backlog, or Launch now to copy the command and start immediately.";
}

/**
 * Map (schema, values, enabled) → PreviewParam[] for the live
 * CommandPreviewPanel.
 *
 * iterate/v030-five-ux-fixes (P1) — `enabled` is now an explicit input.
 * Optional string/enum fields render in the preview only when their
 * enable-checkbox is on AND the value is non-empty. Required fields are
 * always considered enabled (handled at the modal-level seeding). Boolean
 * fields keep their consolidated semantic: checked == enabled == emit.
 *
 * Mirrors the server's resolveParameters logic but is simpler — the
 * preview is approximate (server is authoritative on the actual command).
 */
function paramsToPreview(
  schema: RenderableParamSchema[],
  values: Record<string, string | boolean>,
  enabled: Record<string, boolean>,
): PreviewParam[] {
  const out: PreviewParam[] = [];
  for (const s of schema) {
    const v: string | boolean | undefined = values[s.name];
    if (s.type === "boolean") {
      if (v !== true || !s.cli_flag) continue;
      out.push({ cli_flag: s.cli_flag, separator: "none" });
      continue;
    }
    // String / enum: optional fields require enabled=true. Required
    // fields are always treated as enabled (the modal seeds them on
    // open). The check works for both because required fields receive
    // `paramEnabled[name] = true` from the reset effect.
    if (!s.required && enabled[s.name] !== true) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    let flag: string | undefined = s.cli_flag;
    if (s.type === "enum" && s.cli_flag_map) {
      flag = s.cli_flag_map[trimmed];
    }
    if (!flag) continue;
    out.push({
      cli_flag: flag,
      value: trimmed,
      separator: s.value_separator ?? "space",
      sensitive: s.sensitive,
    });
  }
  return out;
}

/**
 * Drop schema entries that the user did NOT explicitly enable.
 *
 * iterate/v030-five-ux-fixes (P1) — explicit enable-checkbox is now the
 * authoritative "user wants to emit" signal for string/enum params.
 * Boolean params remain consolidated (checked = enable = value).
 *
 * Forwarding rules:
 *   - Boolean: forward `true`; drop everything else.
 *   - String/Enum: forward only when enabled === true AND value is a
 *     non-empty trimmed string. Disabled or empty → drop (skip-emit).
 *     This matches the server-side resolver's "empty value = skip
 *     emission" semantic (parameter-resolver.ts:272-273).
 *
 * Required+default fields are seeded on modal-open with the schema
 * default in `paramValues`, so the user can submit immediately if the
 * default is acceptable. The modal-level `requiredMissing` gate blocks
 * submit if the user clears the value.
 */
function explicitParamEntries(
  schema: RenderableParamSchema[],
  values: Record<string, string | boolean>,
  enabled: Record<string, boolean>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const p of schema) {
    const v = values[p.name];
    if (p.type === "boolean") {
      if (v === true) out[p.name] = true;
      continue;
    }
    // Required fields are always considered enabled (forced-on by the
    // modal's reset effect); the explicit-enabled flag is also seeded
    // true for them so this check is a no-op there.
    if (enabled[p.name] !== true) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    out[p.name] = trimmed;
  }
  return out;
}
