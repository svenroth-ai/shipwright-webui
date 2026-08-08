/*
 * PerProjectTriageSection.tsx — one project's Triage tab section: a flat,
 * filtered + sorted open-items list (iterate-2026-08-08-triage-filters-
 * sort-parked replaced the old per-source grouped sections with this)
 * plus the Deferred section below.
 *
 * Extracted out of TriagePage.tsx (iterate-2026-08-05-triage-deferred-
 * envelope) — that file is bloat-baselined at exactly 283 lines with zero
 * headroom, so mounting DeferredTriageSection required this move first.
 *
 * The section's visibility gate is keyed off the RAW (pre-filter) item
 * counts, never the filtered/visible counts — a project whose items are
 * all filtered out must still render its heading + hidden-count line,
 * never silently `null` (AC5; corrected during internal plan review,
 * where the first draft gated on the filtered arrays and would have
 * made a fully-filtered project vanish with no explanation).
 */

import { useMemo, useState } from "react";

import { useTriageDrift, useTriageItems } from "../../hooks/useTriage";
import { TriageItemCard } from "./TriageItemCard";
import { TriageDetailModal } from "./TriageDetailModal";
import { DeferredTriageSection } from "./DeferredTriageSection";
import { sortDeferred } from "../../lib/sortDeferred";
import {
  formatCount,
  selectVisibleDeferredItems,
  selectVisibleOpenItems,
  sortItems,
  type TriageFilterState,
  type TriageSortState,
} from "../../lib/triageFilterSort";
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
  filters,
  sort,
  onFixNow,
  onNavigateToBoard,
}: {
  project: Project;
  filters: TriageFilterState;
  sort: TriageSortState;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}) {
  const { data: items = [], isLoading } = useTriageItems(project.id);
  const { data: drift } = useTriageDrift(project.id);
  const [selected, setSelected] = useState<TriageItem | null>(null);

  // Raw (unfiltered) buckets — used both as selector input and, crucially,
  // as the section's visibility gate (AC5 — never gate on the filtered result).
  const openItems = useMemo(() => filterTriage(items), [items]);
  const deferredItemsRaw = useMemo(
    () => items.filter((it) => it.status === "snoozed"),
    [items],
  );

  const { visible: visibleOpen, hiddenCount: openHiddenCount } = useMemo(
    () => selectVisibleOpenItems(openItems, filters),
    [openItems, filters],
  );
  const sortedVisibleOpen = useMemo(
    () => sortItems(visibleOpen, sort),
    [visibleOpen, sort],
  );

  const { visible: visibleDeferred, hiddenCount: deferredHiddenCount } = useMemo(
    () => selectVisibleDeferredItems(deferredItemsRaw, filters),
    [deferredItemsRaw, filters],
  );
  const sortedVisibleDeferred = useMemo(
    () => sortDeferred(visibleDeferred, SEVERITY_RANK),
    [visibleDeferred],
  );

  if (isLoading) {
    return (
      <section className="mb-8" data-testid={`triage-project-${project.id}`}>
        <h2 className="text-base font-semibold mb-2 text-[var(--ink)]">{project.name}</h2>
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </section>
    );
  }

  if (openItems.length === 0 && deferredItemsRaw.length === 0) {
    return null;
  }

  return (
    <section className="mb-8" data-testid={`triage-project-${project.id}`}>
      {/* on-photo-legibility fix: the project name + its (count) subtitle
          ride bare on the deck-golden photo, so they use the flipping
          Weather-Deck `--ink` / `--muted` tokens (white under
          `.on-photo`), NOT the legacy `--color-text` / `--color-muted`
          aliases (computed at :root → stay dark, invisible). */}
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-[var(--ink)]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: project.settings?.color ?? "var(--color-muted)",
          }}
        />
        <span>{project.name}</span>
        <span className="text-xs text-[var(--muted)] font-normal">
          ({formatCount(sortedVisibleOpen.length, openItems.length)})
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
      {openHiddenCount > 0 && (
        <p
          className="text-xs text-[var(--muted)] mb-2"
          data-testid={`triage-hidden-count-${project.id}`}
        >
          {openHiddenCount} hidden by filter.
        </p>
      )}
      {sortedVisibleOpen.length > 0 && (
        <div className="space-y-2 mb-4" data-testid={`triage-open-items-${project.id}`}>
          {sortedVisibleOpen.map((item) => (
            <TriageItemCard
              key={item.id}
              item={item}
              onClick={() => setSelected(item)}
            />
          ))}
        </div>
      )}
      <DeferredTriageSection
        items={sortedVisibleDeferred}
        hiddenCount={deferredHiddenCount}
        onClick={setSelected}
      />
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
