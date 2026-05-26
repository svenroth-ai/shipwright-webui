/*
 * Shared types for the NewIssueModal directory. See ../../../planning/iterate
 * campaign-C C4 spec for the directory layout.
 *
 * `NewIssueModalProps` MUST stay identical to the pre-split public surface —
 * both call-sites (TaskBoardPage, TriagePage) consume it by name. Any
 * deviation breaks the bit-perfect-behavior cleanup-invariant for C4.
 */

import type { ReactNode } from "react";
import type {
  ActionDefinition,
  ResolvedProjectActions,
} from "../../../lib/externalApi";

/**
 * 2026-04-25 — iterate-custom-actions-generic-mode. `"generic"` is the
 * fall-through for any action whose id is not one of the four bundled
 * Shipwright modes. It hides the Shipwright-specific UI and reads its
 * label + subheading from the action definition itself.
 */
export type Mode =
  | "new-task"
  | "new-pipeline"
  | "new-iterate"
  | "new-plain"
  | "generic";

export type SubmitAction = "save" | "launch";

/** Per-mode palette token set. See `palette.ts` for the bundled values. */
export interface ModePalette {
  /** bg for 34x34 icon tile + helper box body */
  bg: string;
  /** fg for the icon glyph + helper text */
  text: string;
  /** strong/label color in the helper body */
  textStrong: string;
  /** stripe color for helper box left border + command-preview left stripe */
  stripe: string;
}

/**
 * Stable public props for the NewIssueModal dispatcher. Mirror of the
 * pre-split signature.
 *
 * Per memory `project_launch_description_needs_actionid`: description
 * persistence flows through actionId on /launch — the modal forwards
 * description to BOTH the create body and the launch body, gated by
 * `description.trim().length > 0`.
 */
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
  /**
   * Default is a no-op — Save-to-Backlog success is already visible
   * to the user via the task appearing in the Draft column.
   */
  onToast?: (msg: string, sev: "info" | "error") => void;
  /**
   * iterate-2026-05-21-triage-fix-now-and-phase-slash — pre-fill props
   * for callers (e.g. Triage Fix-now). Consumed by the open: false → true
   * reset effect.
   */
  initialTitle?: string;
  initialDescription?: string;
  initialPhaseId?: string;
  initialPriority?: "P0" | "P1" | "P2" | "P3";
  initialDomain?: string;
  /**
   * iterate-2026-05-22-triage-fix-now-project-preselect — explicit project
   * pre-fill that wins over useProjectFilter()'s sidebar scope.
   */
  initialProjectId?: string;
}

/** Helper to keep body components decoupled from the shell's children API. */
export interface BodyRenderProps {
  /** The currently-resolved mode (drives field visibility). */
  mode: Mode;
  /** The action that was picked (never null inside a body — dispatcher guards). */
  action: ActionDefinition;
}

export type { ActionDefinition, ResolvedProjectActions, ReactNode };
