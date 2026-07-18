/*
 * Per-mode visual tokens + mode resolution + heading/subheading helpers.
 *
 * Extracted from the pre-split NewIssueModal.tsx (lines 149-205, 1397-1424).
 * Pure functions only — no React imports beyond ReactNode for icon return
 * types. The body components import these to keep their LOC budget low.
 *
 * `resolveMode(action)` is the explicit fallback for unknown action.id
 * (Step 3.5 review OpenAI #5): bundled IDs map to bespoke modes; everything
 * else (including custom .shipwright-webui/actions.json entries like
 * `new-content-orchestrator`) lands in `"generic"`. A null action resolves
 * to `"new-task"` for the initial-render frame so palette lookup never
 * crashes — the dispatcher early-returns null before any body renders, so
 * this branch is purely defensive.
 */

import {
  CheckSquare,
  RotateCw,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ActionDefinition } from "../../../lib/externalApi";
import type { Mode, ModePalette } from "./types";

export const PALETTE: Record<Mode, ModePalette> = {
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
    bg: "var(--surface-form-sunken, #e4dfda)",
    text: "var(--body, #44403c)",
    textStrong: "#374151",
    stripe: "var(--color-accent, #857568)",
  },
  // v0.4 — Generic / custom actions from `.shipwright-webui/actions.json`. Same slate
  // family as Plain Claude but slightly cooler so a custom action is
  // visually distinct from the bundled "no-skill" mode.
  generic: {
    bg: "var(--surface-form-sunken, #e4dfda)",
    text: "var(--body, #44403c)",
    textStrong: "#1f2937",
    stripe: "var(--color-primary, #6b5e56)",
  },
};

export function resolveMode(action: ActionDefinition | null): Mode {
  if (!action) return "new-task";
  if (action.id === "new-task") return "new-task";
  if (action.id === "new-pipeline") return "new-pipeline";
  if (action.id === "new-iterate") return "new-iterate";
  if (action.id === "new-plain") return "new-plain";
  return "generic";
}

export function modeIcon(mode: Mode): ReactNode {
  if (mode === "new-pipeline") return <Workflow size={18} strokeWidth={1.6} />;
  if (mode === "new-iterate") return <RotateCw size={18} strokeWidth={1.7} />;
  if (mode === "new-plain") return <Terminal size={18} strokeWidth={1.8} />;
  if (mode === "generic") return <Sparkles size={18} strokeWidth={1.7} />;
  return <CheckSquare size={18} strokeWidth={1.8} />;
}

export function modeHeading(
  mode: Mode,
  action: ActionDefinition | null,
): string {
  if (mode === "new-pipeline") return "New Pipeline";
  if (mode === "new-iterate") return "New Iterate";
  if (mode === "new-plain") return "Plain Claude";
  if (mode === "generic") return action ? `New ${action.label}` : "New Action";
  return "New Task";
}

export function modeSubheading(
  mode: Mode,
  action: ActionDefinition | null,
): string {
  if (mode === "new-pipeline")
    return "Full Shipwright SDLC. Save it to the Backlog, or Launch to auto-run the command in the embedded terminal.";
  if (mode === "new-iterate")
    return "Lightweight change on a completed project. Save it to the Backlog, or Launch to auto-run the command in the embedded terminal.";
  if (mode === "new-plain")
    return "Plain Claude session in this project's directory. No skill, no slash command — just a chat.";
  if (mode === "generic")
    return (
      action?.description ??
      "Custom action from this project's .shipwright-webui/actions.json. Save it to the Backlog, or Launch to auto-run the command in the embedded terminal."
    );
  return "Standalone task scoped to a Shipwright phase. Save it to the Backlog, or Launch to auto-run the command in the embedded terminal.";
}

/** Width of the modal content. Pipeline gets the wider layout. */
export function modeWidthClass(mode: Mode): string {
  return mode === "new-pipeline" ? "w-[580px]" : "w-[540px]";
}
