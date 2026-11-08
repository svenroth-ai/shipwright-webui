/* Shared builders for Triage unit tests (iterate-2026-11-08-triage-page-redesign). */

import type { TriageItem } from "../lib/triageApi";
import { DEFAULT_FILTER_STATE, type TriageEntry, type TriageFilterState } from "../lib/triageFilterSort";

export function item(overrides: Partial<TriageItem> & Pick<TriageItem, "id">): TriageItem {
  return {
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "t",
    detail: "d",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    amendedBy: null,
    amendedAt: null,
    ...overrides,
  };
}

export function entry(
  projectId: string,
  overrides: Partial<TriageItem> & Pick<TriageItem, "id">,
): TriageEntry {
  return { projectId, item: item(overrides) };
}

export function filters(overrides: Partial<TriageFilterState> = {}): TriageFilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}
