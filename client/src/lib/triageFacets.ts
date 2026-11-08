/*
 * triageFacets.ts — live option counts for the Triage filter menu
 * (iterate-2026-11-08-triage-page-redesign). Counted over the open entries
 * in the current project scope, so a number answers "how many would I see
 * if I ticked this".
 */

import { getComplexity, type TriageEntry } from "./triageFilterSort";

export interface Facets {
  severities: Record<string, number>;
  sources: Record<string, number>;
  priorities: Record<string, number>;
  domains: Record<string, number>;
  complexities: Record<string, number>;
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

export function computeFacets(entries: readonly TriageEntry[]): Facets {
  // Null-prototype maps: source/domain are free strings, so a key such as
  // "constructor" or "__proto__" must not collide with Object.prototype.
  const dict = (): Record<string, number> => Object.create(null) as Record<string, number>;
  const f: Facets = { severities: dict(), sources: dict(), priorities: dict(), domains: dict(), complexities: dict() };
  for (const { item } of entries) {
    bump(f.severities, item.severity);
    bump(f.sources, item.source);
    bump(f.priorities, item.suggestedPriority);
    bump(f.domains, item.suggestedDomain);
    bump(f.complexities, getComplexity(item));
  }
  return f;
}

/** Values to list for a group: everything seen, plus ticked values that are no longer present. */
export function optionValues(
  counts: Record<string, number>,
  ticked: ReadonlySet<string>,
  fixedOrder?: readonly string[],
): string[] {
  const seen = new Set([...Object.keys(counts), ...ticked]);
  if (fixedOrder) {
    const extra = [...seen].filter((v) => !fixedOrder.includes(v)).sort();
    return [...fixedOrder, ...extra];
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "und", { sensitivity: "base" }));
}
