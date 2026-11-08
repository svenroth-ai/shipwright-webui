/*
 * TriagePage — one aggregated list of `<project>/.shipwright/triage.jsonl`
 * items (iterate-2026-11-08-triage-page-redesign, FR-01.30). Board-style
 * header toolbar (project filter, filter funnel, group, sort), three summary
 * tiles, active-filter chips, collapsible groups of solid cards and a
 * read-only Parked section. The whole view (filters, sort, grouping, which
 * groups are folded) is saved in the browser; only the project choice is
 * shared with the Board.
 *
 * Every entry is a `{projectId, item}` pair — triage ids can repeat across
 * projects — and every action is bound to the entry's own project.
 *
 * Fix now hands a FixNowIntent up; this page owns the NewIssueModal so it
 * survives the detail modal closing (iterate-2026-05-21).
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";
import { useProjectActions } from "../hooks/useProjectActions";
import { useProjectFilter } from "../hooks/useProjectFilter";
import { useAllTriageItems } from "../hooks/useTriage";
import { useTriageViewState } from "../hooks/useTriageViewState";
import { NewIssueModal } from "../components/external/NewIssueModal";
import { ProjectFilterDropdown } from "../components/external/ProjectFilterDropdown";
import { PageHead } from "../components/common/PageHead";
import { DensityToggle } from "../components/command/DensityToggle";
import { TriageActiveFilters } from "../components/triage/TriageActiveFilters";
import { TriageDetailModal } from "../components/triage/TriageDetailModal";
import { TriageFilterMenu } from "../components/triage/TriageFilterMenu";
import { TriageGroupList } from "../components/triage/TriageGroupList";
import { TriageItemCard } from "../components/triage/TriageItemCard";
import { TriageProjectStatus } from "../components/triage/TriageProjectStatus";
import { SEARCH_MIN_ITEMS, TriageSearch } from "../components/triage/TriageSearch";
import { TriageTiles, type TriageTile } from "../components/triage/TriageTiles";
import { TriageGroupMenu, TriageSortMenu } from "../components/triage/TriageViewMenus";
import type { FixNowIntent } from "../components/triage/fixNowIntent";
import { entryKey, type TriageEntry } from "../lib/triageFilterSort";
import { buildBoardModel, type TriageTileFilter } from "../lib/triageBoardModel";
import { getProjectColor } from "../lib/projectColor";

interface FixNowModalState {
  open: boolean;
  projectId: string | null;
  intent: FixNowIntent | null;
}

const FIX_NOW_INITIAL: FixNowModalState = { open: false, projectId: null, intent: null };

export default function TriagePage() {
  const { data: projects = [] } = useProjects();
  const navigate = useNavigate();
  const { activeProjectId, setActiveProjectId } = useProjectFilter();
  const realProjects = useMemo(() => projects.filter((p) => !p.synthesized), [projects]);
  const projectIds = useMemo(() => realProjects.map((p) => p.id), [realProjects]);

  const view = useTriageViewState();
  const { entries: allEntries, statuses } = useAllTriageItems(projectIds);
  const [tile, setTile] = useState<TriageTileFilter>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TriageEntry | null>(null);
  const [fixNowModal, setFixNowModal] = useState<FixNowModalState>(FIX_NOW_INITIAL);
  const fixNowProjectActions = useProjectActions(fixNowModal.projectId);

  // A saved / shared project id that is no longer a real project falls back
  // to "All projects" rather than an empty page.
  const scopeId =
    activeProjectId !== null && projectIds.includes(activeProjectId) ? activeProjectId : null;
  const scoped = useMemo(
    () => (scopeId === null ? allEntries : allEntries.filter((e) => e.projectId === scopeId)),
    [allEntries, scopeId],
  );
  const scopedStatuses = useMemo(
    () => (scopeId === null ? statuses : statuses.filter((s) => s.projectId === scopeId)),
    [statuses, scopeId],
  );

  const groupProjects = useMemo(
    () =>
      realProjects.map((p) => ({
        id: p.id,
        name: p.name,
        color: getProjectColor(p.id, p.settings?.color).hsl,
      })),
    [realProjects],
  );
  const nameOf = useMemo(() => {
    const m = new Map(realProjects.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? id;
  }, [realProjects]);

  const searchVisible = scoped.filter((e) => e.item.status === "triage").length > SEARCH_MIN_ITEMS;
  const model = useMemo(
    () =>
      buildBoardModel({
        entries: scoped,
        filters: view.filters,
        sort: view.sort,
        groupBy: view.groupBy,
        search: searchVisible ? search : "",
        tile,
        projects: groupProjects,
      }),
    [scoped, view.filters, view.sort, view.groupBy, search, searchVisible, tile, groupProjects],
  );

  const onNavigateToBoard = (projectId: string): void => {
    setActiveProjectId(projectId);
    navigate("/");
  };
  const onFixNow = (projectId: string, intent: FixNowIntent): void => {
    setFixNowModal({ open: true, projectId, intent });
  };
  const onTile = (t: TriageTile): void => {
    if (t === "parked") view.setShowParked(!view.filters.showParked);
    else setTile(t === "attn" && tile !== "attn" ? "attn" : null);
  };

  const loaded = scopedStatuses.every((s) => !s.isLoading);
  const anyError = scopedStatuses.some((s) => s.isError);
  const nothingShown = model.visibleOpen.length === 0 && model.visibleParked.length === 0;
  // "All clear" only when nothing is open (and no parked card is on screen) and
  // no project failed to load; "filtered out" only when open items exist but
  // are all narrowed away — never when only Show-parked-off items remain.
  // Parked items the attribute filters excluded (not merely the Show-parked switch).
  const switchHidden = view.filters.showParked
    ? 0
    : model.parkedAll.filter((e) => e.item.revisitAt && !e.item.revisitDue).length;
  const parkedFiltered = Math.max(0, model.hiddenParked - switchHidden);
  const showEmpty =
    loaded && !anyError && model.openAll.length === 0 && model.visibleParked.length === 0 && parkedFiltered === 0;
  const showFilteredOut = loaded && nothingShown && (model.openAll.length > 0 || parkedFiltered > 0);
  // Parked items hidden only by the Show-parked switch have their own hint.
  const hiddenTotal =
    model.openAll.length - model.visibleOpen.length + (view.filters.showParked ? model.hiddenParked : 0);
  const several = scopeId === null && realProjects.length > 1;
  const projectLabel = (id: string) => (several ? nameOf(id) : undefined);

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bg)" }} data-testid="triage-page">
      <PageHead
        title="Triage"
        small={<span data-testid="triage-header-count">({model.openAll.length})</span>}
        testId="triage-header"
        actionsClassName="chrome-dark-controls"
        actions={
          <>
            <ProjectFilterDropdown />
            <TriageFilterMenu view={view} facets={model.facets} parkedCount={model.parkedAll.length} />
            <TriageGroupMenu groupBy={view.groupBy} onChange={view.setGroupBy} />
            <TriageSortMenu view={view} />
            <DensityToggle />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto pt-4 pb-10 md:pt-6">
        <div className="page-container density-surface">
          {realProjects.length === 0 ? (
            <p className="text-sm text-[var(--muted)]" data-testid="triage-no-projects">
              No projects registered. Add a project on the Projects page first.
            </p>
          ) : (
            <>
              <TriageProjectStatus statuses={scopedStatuses} nameOf={nameOf} named={several} />
              <TriageTiles
                open={model.openAll.length}
                attention={model.attention}
                parked={model.parkedAll.length}
                selected={tile}
                showParked={view.filters.showParked}
                onSelect={onTile}
              />
              {searchVisible && <TriageSearch value={search} onChange={setSearch} />}
              <TriageActiveFilters
                view={view}
                shown={model.visibleOpen.length}
                total={model.openAll.length}
                tileLabel={tile === "attn" ? "Critical + High" : null}
                onClearTile={() => {
                  setTile(null);
                  setSearch("");
                }}
              />
              <TriageGroupList
                groups={model.groups}
                groupBy={view.groupBy}
                collapsed={view.collapsed}
                onToggle={view.toggleCollapsed}
                projectLabel={projectLabel}
                onOpen={setSelected}
                onFixNow={onFixNow}
                onNavigateToBoard={onNavigateToBoard}
              />
              {model.visibleParked.length > 0 && (
                <section className="mt-6" data-testid="triage-parked-section">
                  <h2 className="mb-2 text-base font-semibold text-[var(--ink)]">
                    Parked <span className="text-xs font-normal text-[var(--muted)]">({model.visibleParked.length})</span>
                  </h2>
                  <div className="space-y-1.5 max-md:space-y-1">
                    {model.visibleParked.map((e) => (
                      <TriageItemCard
                        key={entryKey(e)}
                        projectId={e.projectId}
                        item={e.item}
                        projectLabel={projectLabel(e.projectId)}
                        onOpen={() => setSelected(e)}
                        onFixNow={onFixNow}
                        onNavigateToBoard={onNavigateToBoard}
                      />
                    ))}
                  </div>
                </section>
              )}
              {model.hiddenParked > 0 && !view.filters.showParked && (
                <p className="mt-3 text-xs text-[var(--muted)]" data-testid="triage-parked-hidden-hint">
                  {model.hiddenParked} parked item{model.hiddenParked === 1 ? "" : "s"} hidden — switch on
                  &ldquo;Show parked&rdquo; in the filter menu to see them.
                </p>
              )}
              {showEmpty && (
                <p className="py-8 text-center text-sm text-[var(--muted)]" data-testid="triage-empty-state">
                  No triage items pending. ✓
                </p>
              )}
              {showFilteredOut && (
                <p className="py-8 text-center text-sm text-[var(--muted)]" data-testid="triage-all-filtered-out">
                  {hiddenTotal > 0 ? `${hiddenTotal} hidden by the current view` : "Nothing matches"} —{" "}
                  <button
                    type="button"
                    onClick={() => {
                      view.clearFilters();
                      setTile(null);
                      setSearch("");
                    }}
                    className="underline hover:text-[var(--ink)]"
                    data-testid="triage-all-filtered-out-clear"
                  >
                    clear filters
                  </button>{" "}
                  to see them.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {selected && (
        <TriageDetailModal
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          projectId={selected.projectId}
          item={selected.item}
          onFixNow={(intent) => onFixNow(selected.projectId, intent)}
          onNavigateToBoard={() => onNavigateToBoard(selected.projectId)}
        />
      )}

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
        initialProjectId={fixNowModal.intent?.projectId}
      />
    </div>
  );
}
