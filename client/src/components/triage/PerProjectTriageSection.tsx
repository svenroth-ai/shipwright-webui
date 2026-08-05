/*
 * PerProjectTriageSection.tsx — one project's Triage tab section: open
 * items (source-grouped, severity-sorted) plus the Deferred section below.
 *
 * Extracted out of TriagePage.tsx (iterate-2026-08-05-triage-deferred-
 * envelope) — that file is bloat-baselined at exactly 283 lines with zero
 * headroom, so mounting DeferredTriageSection required this move first.
 * Behavior for the open-items half is otherwise unchanged from the
 * pre-extraction `PerProjectSection`.
 */

import { useMemo, useState } from "react";

import { useTriageDrift, useTriageItems } from "../../hooks/useTriage";
import { TriageItemCard } from "./TriageItemCard";
import { TriageDetailModal } from "./TriageDetailModal";
import { DeferredTriageSection } from "./DeferredTriageSection";
import { sortDeferred } from "../../lib/sortDeferred";
import type { FixNowIntent } from "./fixNowIntent";
import type { TriageItem, TriageSeverity } from "../../lib/triageApi";
import { filterTriage } from "../../lib/triageApi";
import type { Project } from "../../types";

export const SEVERITY_RANK: Record<TriageSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function PerProjectTriageSection({
  project,
  onFixNow,
  onNavigateToBoard,
}: {
  project: Project;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}) {
  const { data: items = [], isLoading } = useTriageItems(project.id);
  const { data: drift } = useTriageDrift(project.id);
  const [selected, setSelected] = useState<TriageItem | null>(null);

  const triageItems = useMemo(() => filterTriage(items), [items]);
  const deferredItems = useMemo(
    () => sortDeferred(items.filter((it) => it.status === "snoozed"), SEVERITY_RANK),
    [items],
  );

  const itemsBySource = useMemo(() => {
    const map = new Map<string, TriageItem[]>();
    for (const it of triageItems) {
      const arr = map.get(it.source) ?? [];
      arr.push(it);
      map.set(it.source, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const sevDiff =
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sevDiff !== 0) return sevDiff;
        // Newest-first within stable severity rank
        return b.originalTs.localeCompare(a.originalTs);
      });
    }
    return map;
  }, [triageItems]);

  const sortedSources = useMemo(
    () => [...itemsBySource.keys()].sort(),
    [itemsBySource],
  );

  if (isLoading) {
    return (
      <section className="mb-8" data-testid={`triage-project-${project.id}`}>
        <h2 className="text-base font-semibold mb-2 text-[var(--ink)]">{project.name}</h2>
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </section>
    );
  }

  if (triageItems.length === 0 && deferredItems.length === 0) {
    return null;
  }

  return (
    <section className="mb-8" data-testid={`triage-project-${project.id}`}>
      {/* on-photo-legibility fix: the project name + its (count) subtitle and
          the per-source group headers (below) ride bare on the deck-golden
          photo, so they use the flipping Weather-Deck `--ink` / `--muted`
          tokens (white under `.on-photo`), NOT the legacy `--color-text` /
          `--color-muted` aliases (computed at :root → stay dark, invisible). */}
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-[var(--ink)]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: project.settings?.color ?? "var(--color-muted)",
          }}
        />
        <span>{project.name}</span>
        <span className="text-xs text-[var(--muted)] font-normal">
          ({triageItems.length})
        </span>
      </h2>
      {drift?.behind != null && drift.behind > 0 && (
        <div
          role="status"
          data-testid={`triage-stale-banner-${project.id}`}
          className="mb-3 rounded-md border border-[var(--warn-line)] bg-warn-tint px-3 py-2 text-xs text-warn dark:border-[var(--warn-line)] dark:bg-warn-tint dark:text-warn"
        >
          Local checkout is {drift.behind} commit{drift.behind === 1 ? "" : "s"} behind
          origin — <code>git pull</code> to sync.
          {drift.available === false
            ? " Origin is unavailable, so already-dismissed items may still appear here."
            : ""}
        </div>
      )}
      {sortedSources.map((source) => (
        <div key={source} className="mb-4">
          <h3 className="text-xs font-semibold text-[var(--ink)] uppercase mb-2">
            {source} ({itemsBySource.get(source)!.length})
          </h3>
          <div className="space-y-2">
            {itemsBySource.get(source)!.map((item) => (
              <TriageItemCard
                key={item.id}
                item={item}
                onClick={() => setSelected(item)}
              />
            ))}
          </div>
        </div>
      ))}
      <DeferredTriageSection items={deferredItems} onClick={setSelected} />
      {selected && (
        <TriageDetailModal
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          projectId={project.id}
          item={selected}
          onFixNow={(intent) => onFixNow(project.id, intent)}
          onNavigateToBoard={() => onNavigateToBoard(project.id)}
        />
      )}
    </section>
  );
}
