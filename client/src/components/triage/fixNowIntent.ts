/*
 * fixNowIntent.ts — shared decision helper for Triage Fix-now routing
 * (iterate-2026-05-21-triage-fix-now-and-phase-slash).
 *
 * Lives in its own module so TriagePage and TriageDetailModal can call
 * the same function — keeps the source-only discriminator in ONE place.
 * TriagePage owns the NewIssueModal mount (so it survives TriageDetailModal
 * unmount on `onOpenChange(false)`); TriageDetailModal builds the intent
 * and hands it up via `onFixNow`. Centralising the resolver here means a
 * future call site (e.g. a Fix-now CTA on the TriageItemCard hover) gets
 * the same routing for free.
 */

import type { ActionDefinition, ResolvedProjectActions } from "../../lib/externalApi";
import type { TriageItem, TriagePriority } from "../../lib/triageApi";

/**
 * iterate-2026-05-21 — source-only discriminator. Empirically validated
 * against Sven's Triage Tab screenshot 2026-05-21: github-source items
 * in this repo are security-scan rollups (gh-security-triage.py
 * aggregate of code-scanning + dependabot + shipwright-security);
 * everything else (iterate, phaseQuality, compliance) is iterate-flow
 * material. Extend this set only when a new source empirically maps to
 * the security phase.
 */
const SECURITY_SOURCES = new Set(["github"]);

export function isSecuritySource(item: TriageItem): boolean {
  return SECURITY_SOURCES.has(item.source);
}

export interface FixNowIntent {
  action: ActionDefinition;
  // iterate-2026-05-22-triage-fix-now-project-preselect — the project
  // the triage item belongs to. Threaded through the intent so the
  // parent (TriagePage) can pre-select it in the spawned NewIssueModal.
  // Before this iterate the project was silently dropped; the modal
  // fell back to realProjects[0] / sidebar filter and the user had to
  // re-pick it manually.
  projectId: string;
  initialTitle: string;
  initialDescription: string;
  initialPhaseId?: string;
  initialPriority?: TriagePriority;
  initialDomain?: string;
}

export type FixNowResolution =
  | { kind: "ok"; intent: FixNowIntent }
  | { kind: "failed"; message: string };

/**
 * Resolve a (triage item, project-actions catalog) pair into a
 * NewIssueModal-ready intent. Returns a structured failure when the
 * catalog has not loaded OR the resolved actionId is missing from the
 * catalog so callsites can surface an inline error without half-routing
 * the user.
 */
export function buildFixNowIntent(
  item: TriageItem,
  catalog: ResolvedProjectActions | undefined,
  projectId: string,
): FixNowResolution {
  if (!catalog) {
    return {
      kind: "failed",
      message:
        "Action catalog not loaded — try again in a moment, or refresh the page.",
    };
  }
  const isSecurity = isSecuritySource(item);
  const targetActionId = isSecurity ? "new-task" : "new-iterate";
  const action = catalog.actions.find((a) => a.id === targetActionId);
  if (!action) {
    return {
      kind: "failed",
      message: `Action "${targetActionId}" missing from this project's catalog.`,
    };
  }
  return {
    kind: "ok",
    intent: {
      action,
      projectId,
      initialTitle: `Fix for ${item.title}`,
      initialDescription: item.detail,
      initialPhaseId: isSecurity ? "security" : undefined,
      initialPriority: item.suggestedPriority,
      initialDomain: item.suggestedDomain,
    },
  };
}
