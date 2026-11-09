/*
 * triageGrouping.ts — pure grouping of triage entries for the Triage page
 * (iterate-2026-11-08-triage-page-redesign). Input order is preserved inside
 * every group, so the caller sorts first and groups second.
 */

import {
  PRIORITY_VALUES,
  SEVERITY_VALUES,
  type TriageEntry,
} from "./triageFilterSort";

export type GroupBy = "none" | "project" | "severity" | "source" | "priority";

export const GROUP_BY_VALUES: readonly GroupBy[] = [
  "none",
  "project",
  "severity",
  "source",
  "priority",
];

export interface GroupProject {
  id: string;
  name: string;
  /** CSS colour (a token or the project's own setting) for the dot. */
  color?: string;
}

export interface TriageGroup {
  /** Stable key, `<groupBy>:<value>` — also the persisted collapse key. */
  key: string;
  label: string;
  color?: string;
  entries: TriageEntry[];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function groupEntries(
  entries: TriageEntry[],
  groupBy: GroupBy,
  projects: readonly GroupProject[],
  sourceLabel: (source: string) => string,
): TriageGroup[] {
  if (groupBy === "none") {
    return entries.length > 0 ? [{ key: "none:all", label: "", entries }] : [];
  }

  const buckets = new Map<string, TriageEntry[]>();
  const valueOf = (e: TriageEntry): string =>
    groupBy === "project"
      ? e.projectId
      : groupBy === "severity"
        ? e.item.severity
        : groupBy === "source"
          ? e.item.source
          : e.item.suggestedPriority;
  for (const e of entries) {
    const v = valueOf(e);
    const list = buckets.get(v);
    if (list) list.push(e);
    else buckets.set(v, [e]);
  }

  let order: string[];
  if (groupBy === "project") {
    order = projects.map((p) => p.id);
  } else if (groupBy === "severity") {
    order = [...SEVERITY_VALUES];
  } else if (groupBy === "priority") {
    order = [...PRIORITY_VALUES];
  } else {
    order = [...buckets.keys()].sort((a, b) =>
      sourceLabel(a).localeCompare(sourceLabel(b), "und", { sensitivity: "base" }),
    );
  }
  // Values outside the known order (unknown severity, vanished project) are
  // appended rather than dropped — a card must never disappear.
  for (const v of buckets.keys()) if (!order.includes(v)) order.push(v);

  const groups: TriageGroup[] = [];
  for (const v of order) {
    const list = buckets.get(v);
    if (!list || list.length === 0) continue;
    const project = groupBy === "project" ? projects.find((p) => p.id === v) : undefined;
    groups.push({
      key: `${groupBy}:${v}`,
      label:
        groupBy === "project"
          ? (project?.name ?? v)
          : groupBy === "source"
            ? sourceLabel(v)
            : groupBy === "severity"
              ? cap(v)
              : v,
      color: project?.color,
      entries: list,
    });
  }
  return groups;
}
