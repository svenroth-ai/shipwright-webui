/*
 * TriagePage — read-only list of `<project>/.shipwright/triage.jsonl`
 * items aggregated across registered projects (status==triage filter).
 *
 * Layout: project-grouped (color-coded sidebar dot mirrors InboxPage)
 * → source-grouped (alphabetical, mirrors aggregate_triage.py)
 * → severity-rank-sorted within each source group.
 *
 * Click → opens TriageDetailModal with Promote / Dismiss / Snooze /
 * Fix-now actions.
 *
 * iterate-2026-05-21-triage-fix-now-and-phase-slash — TriagePage now
 * owns the NewIssueModal mount. TriageDetailModal hands up a FixNowIntent
 * (via `onFixNow`) and self-closes; this page reads the intent into its
 * own `fixNowModal` state and renders NewIssueModal AT PAGE SCOPE so it
 * survives the TriageDetailModal unmount (the `{selected && ...}` guard
 * around TriageDetailModal previously killed the modal before it could
 * paint).
 *
 * Empty-state copy: verbatim from `aggregate_triage.py` line 170.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";
import { useProjectActions } from "../hooks/useProjectActions";
import { useProjectFilter } from "../hooks/useProjectFilter";
import { useTriageCounts, useTriageDrift, useTriageItems } from "../hooks/useTriage";
import { TriageItemCard } from "../components/triage/TriageItemCard";
import { TriageDetailModal } from "../components/triage/TriageDetailModal";
import { NewIssueModal } from "../components/external/NewIssueModal";
import type { FixNowIntent } from "../components/triage/fixNowIntent";
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

interface FixNowModalState {
  open: boolean;
  projectId: string | null;
  intent: FixNowIntent | null;
}

const FIX_NOW_INITIAL: FixNowModalState = {
  open: false,
  projectId: null,
  intent: null,
};

function PerProjectSection({
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
        <p className="text-sm text-muted">Loading…</p>
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
        <span className="text-xs text-muted font-normal">
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
          <h3 className="text-xs font-semibold text-body uppercase mb-2">
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
          onFixNow={(intent) => onFixNow(project.id, intent)}
          onNavigateToBoard={() => onNavigateToBoard(project.id)}
        />
      )}
    </section>
  );
}

export default function TriagePage() {
  const { data: projects = [] } = useProjects();
  const { data: counts } = useTriageCounts();
  const navigate = useNavigate();
  const { setActiveProjectId } = useProjectFilter();
  const realProjects = projects.filter((p) => !p.synthesized);

  // FR-01.33 — after Start Campaign / Go to board, focus the board on the
  // campaign's project (so its lane is visible) and navigate to the board ("/").
  const onNavigateToBoard = (projectId: string): void => {
    setActiveProjectId(projectId);
    navigate("/");
  };

  const totalTriage = counts?.total ?? 0;

  // iterate-2026-05-21 — page-scoped NewIssueModal state. Survives the
  // unmount-on-close of TriageDetailModal (which the `{selected && …}`
  // guard in PerProjectSection performs). The projectId is captured at
  // intent-time so the spawned modal renders in the right project
  // context even if the user later opens a different project's items.
  const [fixNowModal, setFixNowModal] = useState<FixNowModalState>(FIX_NOW_INITIAL);
  // Catalog for the FixNow-target project. Disabled until a project is
  // selected (intent dispatched) so we don't fetch every project's
  // catalog upfront.
  const fixNowProjectActions = useProjectActions(fixNowModal.projectId);

  const onFixNow = (projectId: string, intent: FixNowIntent): void => {
    setFixNowModal({ open: true, projectId, intent });
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--color-bg)" }}
      data-testid="triage-page"
    >
      {/* Header — full-bleed surface bar, matches Inbox/Projects geometry
          (iterate-2026-05-30-page-chrome-cleanup): dropped the muted 20px
          title + "Pre-backlog intake…" subtitle paragraph in favour of the
          shared 24px / 700 dark h1 + inline count badge. */}
      <div
        style={{
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <header
          className="page-container flex items-center justify-between"
          style={{ paddingTop: "20px", paddingBottom: "20px" }}
        >
          <div className="flex items-baseline gap-[10px]">
            <h1
              className="font-bold"
              style={{
                fontSize: "24px",
                color: "var(--color-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Triage
            </h1>
            <span
              className="font-medium"
              style={{ fontSize: "14px", color: "var(--color-muted)" }}
              data-testid="triage-header-count"
            >
              ({totalTriage})
            </span>
          </div>
        </header>
      </div>

      {/* Body — wrapped in .page-container so Triage aligns with Inbox. */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBlock: "12px 40px" }}
      >
        <div className="page-container">
          {realProjects.length === 0 ? (
            <p
              className="text-sm text-muted"
              data-testid="triage-no-projects"
            >
              No projects registered. Add a project on the Projects page
              first.
            </p>
          ) : (
            <>
              {realProjects.map((project) => (
                <PerProjectSection
                  key={project.id}
                  project={project}
                  onFixNow={onFixNow}
                  onNavigateToBoard={onNavigateToBoard}
                />
              ))}
              {counts !== undefined && totalTriage === 0 && (
                <p
                  className="text-center text-sm text-muted py-8"
                  data-testid="triage-empty-state"
                >
                  No triage items pending. ✓
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Page-scoped NewIssueModal — see header docstring. Mounts even
          when no Fix-now is pending so the prop reset effect can do its
          work atomically; `action={null}` early-returns inside the
          modal when there's nothing to render. */}
      <NewIssueModal
        open={fixNowModal.open}
        onOpenChange={(open) => setFixNowModal((p) => ({ ...p, open }))}
        action={fixNowModal.intent?.action ?? null}
        projectActions={fixNowProjectActions.data}
        initialTitle={fixNowModal.intent?.initialTitle}
        initialDescription={fixNowModal.intent?.initialDescription}
        initialPhaseId={fixNowModal.intent?.initialPhaseId}
        initialPriority={fixNowModal.intent?.initialPriority}
        initialDomain={fixNowModal.intent?.initialDomain}
        // iterate-2026-05-22-triage-fix-now-project-preselect — the
        // missing wire that caused the original bug. Without this prop
        // NewIssueModal fell back to realProjects[0] / sidebar filter
        // and the user had to re-pick the project manually even though
        // the triage item already knew which project it belonged to.
        initialProjectId={fixNowModal.intent?.projectId}
      />
    </div>
  );
}
