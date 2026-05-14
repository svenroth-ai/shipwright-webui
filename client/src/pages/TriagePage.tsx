/*
 * TriagePage — read-only list of `<project>/.shipwright/triage.jsonl`
 * items aggregated across registered projects (status==triage filter).
 *
 * Layout: project-grouped (color-coded sidebar dot mirrors InboxPage)
 * → source-grouped (alphabetical, mirrors aggregate_triage.py)
 * → severity-rank-sorted within each source group.
 *
 * Click → opens TriageDetailModal with Promote / Dismiss / Snooze actions.
 *
 * Empty-state copy: verbatim from `aggregate_triage.py` line 170.
 */

import { useMemo, useState } from "react";

import { useProjects } from "../hooks/useProjects";
import { useTriageCounts, useTriageItems } from "../hooks/useTriage";
import { TriageItemCard } from "../components/triage/TriageItemCard";
import { TriageDetailModal } from "../components/triage/TriageDetailModal";
import type { TriageItem, TriageSeverity } from "../lib/triageApi";
import { filterTriage } from "../lib/triageApi";
import type { Project } from "../types";

const SEVERITY_RANK: Record<TriageSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function PerProjectSection({ project }: { project: Project }) {
  const { data: items = [], isLoading } = useTriageItems(project.id);
  const [selected, setSelected] = useState<TriageItem | null>(null);

  const triageItems = useMemo(() => filterTriage(items), [items]);

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
        <h2 className="text-base font-semibold mb-2">{project.name}</h2>
        <p className="text-sm text-stone-500">Loading…</p>
      </section>
    );
  }

  if (triageItems.length === 0) {
    return null;
  }

  return (
    <section className="mb-8" data-testid={`triage-project-${project.id}`}>
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: project.settings?.color ?? "var(--color-muted)",
          }}
        />
        <span>{project.name}</span>
        <span className="text-xs text-stone-500 font-normal">
          ({triageItems.length})
        </span>
      </h2>
      {sortedSources.map((source) => (
        <div key={source} className="mb-4">
          <h3 className="text-xs font-semibold text-stone-700 uppercase mb-2">
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
      {selected && (
        <TriageDetailModal
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          projectId={project.id}
          item={selected}
        />
      )}
    </section>
  );
}

export default function TriagePage() {
  const { data: projects = [] } = useProjects();
  const { data: counts } = useTriageCounts();
  const realProjects = projects.filter((p) => !p.synthesized);

  const totalTriage = counts?.total ?? 0;

  return (
    <div className="max-w-5xl mx-auto py-6 px-4" data-testid="triage-page">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Triage</h1>
        <p className="text-sm text-stone-500 mt-1">
          Pre-backlog intake from Phase-Quality, compliance, and other
          producer hooks. Promote to create a backlog task; dismiss /
          snooze to defer.
        </p>
      </header>

      {realProjects.length === 0 ? (
        <p className="text-sm text-stone-500" data-testid="triage-no-projects">
          No projects registered. Add a project on the Projects page first.
        </p>
      ) : (
        <>
          {realProjects.map((project) => (
            <PerProjectSection key={project.id} project={project} />
          ))}
          {counts !== undefined && totalTriage === 0 && (
            <p
              className="text-center text-sm text-stone-500 py-8"
              data-testid="triage-empty-state"
            >
              No triage items pending. ✓
            </p>
          )}
        </>
      )}
    </div>
  );
}
