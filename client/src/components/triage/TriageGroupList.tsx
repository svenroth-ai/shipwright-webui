/*
 * TriageGroupList — the open-items list as collapsible groups
 * (iterate-2026-11-08-triage-page-redesign). "none" renders one headerless
 * group. Every card is keyed `projectId:itemId` because triage ids can
 * collide across projects.
 */

import { ChevronDown, ChevronRight } from "lucide-react";

import type { GroupBy, TriageGroup } from "../../lib/triageGrouping";
import { entryKey, type TriageEntry } from "../../lib/triageFilterSort";
import { TriageItemCard } from "./TriageItemCard";
import type { FixNowIntent } from "./fixNowIntent";

interface Props {
  groups: readonly TriageGroup[];
  groupBy: GroupBy;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Label per project, shown on cards when not grouped by project. */
  projectLabel: (projectId: string) => string | undefined;
  onOpen: (e: TriageEntry) => void;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}

export function TriageGroupList({
  groups,
  groupBy,
  collapsed,
  onToggle,
  projectLabel,
  onOpen,
  onFixNow,
  onNavigateToBoard,
}: Props) {
  return (
    <div data-testid="triage-open-items">
      {groups.map((g) => {
        // A group holding a returned park never stays folded: the bypass must
        // survive a collapse saved days ago.
        const isCollapsed =
          groupBy !== "none" && collapsed.has(g.key) && !g.entries.some((e) => e.item.revisitDue);
        return (
          <section key={g.key} className="mb-4 max-md:mb-3" data-testid={`triage-group-${g.key}`}>
            {groupBy !== "none" && (
              <h2 className="mb-2 text-base font-semibold text-[var(--ink)]">
                <button
                  type="button"
                  onClick={() => onToggle(g.key)}
                  aria-expanded={!isCollapsed}
                  data-testid={`triage-group-toggle-${g.key}`}
                  className="flex items-center gap-2"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  {g.color && (
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} />
                  )}
                  <span>{g.label}</span>
                  <span className="text-xs font-normal text-[var(--muted)]">({g.entries.length})</span>
                </button>
              </h2>
            )}
            {!isCollapsed && (
              <div className="space-y-1.5 max-md:space-y-1">
                {g.entries.map((e) => (
                  <TriageItemCard
                    key={entryKey(e)}
                    projectId={e.projectId}
                    item={e.item}
                    projectLabel={groupBy === "project" ? undefined : projectLabel(e.projectId)}
                    onOpen={() => onOpen(e)}
                    onFixNow={onFixNow}
                    onNavigateToBoard={onNavigateToBoard}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
