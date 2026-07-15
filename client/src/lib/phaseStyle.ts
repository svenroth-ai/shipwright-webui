/*
 * Phase badge color map — shared between TaskDetailHeader and TaskCard.
 *
 * 2026-04-23 — iterate-20260423-chat-livetest-2 AC-B.
 *
 * Keys are phase ids from `default-actions.json` (lowercase). The resolver
 * returns a `{ cls, dot }` pair: `cls` is a Tailwind class tuple for the
 * chip background + text color, `dot` is the leading status-dot color.
 *
 * `build` style is the fallback for unknown phase ids — same convention
 * as TaskDetailHeader's pre-extraction inline copy. Keep in sync with
 * the phase color palette in `webui/server/src/config/default-actions.json`.
 */

export interface PhaseStyle {
  cls: string;
  dot: string;
}

const PHASE_STYLES: Record<string, PhaseStyle> = {
  project: { cls: "bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-muted,#6b7280)]", dot: "bg-[var(--color-muted)]" },
  design: { cls: "bg-info-tint text-info", dot: "bg-[var(--info-solid)]" },
  plan: { cls: "bg-info-tint text-info", dot: "bg-[var(--info-solid)]" },
  build: { cls: "bg-warn-tint text-warn", dot: "bg-[var(--warn-solid)]" },
  test: { cls: "bg-ok-tint text-ok", dot: "bg-[var(--ok-solid)]" },
  deploy: { cls: "bg-accent-tint text-[var(--color-accent)]", dot: "bg-[var(--color-primary)]" },
  changelog: { cls: "bg-info-tint text-info", dot: "bg-[var(--info-solid)]" },
  compliance: { cls: "bg-info-tint text-info", dot: "bg-[var(--info-solid)]" },
  security: { cls: "bg-err-tint text-err", dot: "bg-[var(--err-solid)]" },
  adopt: { cls: "bg-inset text-[var(--color-text)]", dot: "bg-[var(--color-muted)]" },
  iterate: {
    cls: "bg-[var(--color-muted-bg,#ede8e1)] text-[var(--color-muted,#6b7280)]",
    dot: "bg-[var(--color-accent,#857568)]",
  },
};

/**
 * Resolve the color style for a phase id. Unknown ids fall back to the
 * `build` palette to keep the render safe; callers can check whether the
 * input id was known by comparing against `Object.keys(PHASE_STYLES)`.
 */
export function getPhaseStyle(phaseId: string | undefined): PhaseStyle {
  if (!phaseId) return PHASE_STYLES.build;
  return PHASE_STYLES[phaseId.toLowerCase()] ?? PHASE_STYLES.build;
}

/**
 * Best-effort phase derivation from a task title — used as a fallback
 * when `task.phase` / `task.phaseLabel` are missing (legacy tasks
 * launched before the phase-on-create wiring, or externally-created
 * tasks). Returns `null` when no keyword matches; callers can choose
 * to render no badge in that case.
 *
 * v0.4.1 — tightened keyword boundaries:
 *   - `\badopt\b` branch added (highest priority — "adopt" titles are
 *     unambiguous markers).
 *   - `\bui\b` uses word boundaries so substrings like "webui" or "suite"
 *     don't trigger the design palette. The pre-v0.4.1 regex `/ui/`
 *     matched ANY occurrence anywhere in the string, which produced
 *     bogus design badges for titles like "WebUI Repo Adopten".
 *   - All keywords use word-boundary form for symmetry.
 *
 * Extracted from TaskDetailHeader (2026-04-25) so TaskCard can share
 * the exact same heuristic and display a consistent badge.
 */
/**
 * Resolve the phase badge for an ExternalTask, applying the full policy
 * shared between TaskCard and TaskDetailHeader. Single source of truth
 * for "which phase pill should this task show, if any?".
 *
 * Priority (highest to lowest):
 *   1. `new-plain` action → no phase (free-form chat title).
 *   2. Server-persisted `phase` + `phaseLabel` pair (both required) →
 *      use as-is.
 *   3. `new-iterate` action → always "Iterate", never title-derived.
 *      The action and the phase share an axis; iterate titles are
 *      free-form bug/feature descriptions (e.g. "Fix for SBOM …") and
 *      would otherwise mis-match the title-keyword regex.
 *   4. Legacy title-keyword derivation — pre-phase-on-create tasks.
 *
 * 2026-05-27 — iterate-2026-05-27-fix-phase-pill-iterate-title-fallback:
 * step 3 added to prevent iterate tasks rendering a Build pill when the
 * title begins with "Fix …".
 */
export function resolveTaskPhase(task: {
  actionId?: string | null;
  phase?: string | null;
  phaseLabel?: string | null;
  title?: string | null;
}): { id: string; label: string } | null {
  if (task.actionId === "new-plain") return null;
  if (task.phase && task.phaseLabel) {
    return { id: task.phase, label: task.phaseLabel };
  }
  if (task.actionId === "new-iterate") {
    return { id: "iterate", label: "Iterate" };
  }
  return derivePhaseFromTitle(task.title ?? undefined);
}

export function derivePhaseFromTitle(
  title: string | undefined,
): { id: string; label: string } | null {
  const t = (title ?? "").toLowerCase();
  // Adopt: matches "adopt", "adopted", "adopten" (German), "adopting",
  // "adopts" — but NOT "adoption" (noun has different intent).
  const id = /\badopt(?:e[dn]|ing|s)?\b/.test(t)
    ? "adopt"
    : /\bplan\b/.test(t)
      ? "plan"
      : /\b(?:build|implement|fix)\b/.test(t)
        ? "build"
        : /\b(?:design|ui|mockup)\b/.test(t)
          ? "design"
          : /\b(?:test|qa|e2e)\b/.test(t)
            ? "test"
            : /\biterate\b/.test(t)
              ? "iterate"
              : null;
  if (!id) return null;
  return { id, label: id.charAt(0).toUpperCase() + id.slice(1) };
}
