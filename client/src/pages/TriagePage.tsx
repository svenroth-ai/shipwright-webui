/*
 * TriagePage — list of `<project>/.shipwright/triage.jsonl` items
 * aggregated across registered projects, per-project section owned by
 * PerProjectTriageSection: open items (status==triage) plus a Deferred
 * section (status==snoozed, monorepo P2.03 parity,
 * iterate-2026-08-05-triage-deferred-envelope).
 *
 * Layout: project-grouped (color-coded sidebar dot mirrors InboxPage)
 * → source-grouped (alphabetical, mirrors aggregate_triage.py)
 * → severity-rank-sorted within each source group → Deferred section.
 *
 * Click → opens TriageDetailModal with Promote / Dismiss / Snooze /
 * Fix-now actions (open items only — Deferred is read-only, see the
 * iterate spec's Out of Scope).
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
import { useAllTriageItems, useTriageCounts } from "../hooks/useTriage";
import { useTriageViewState } from "../hooks/useTriageViewState";
import { PerProjectTriageSection } from "../components/triage/PerProjectTriageSection";
import { TriageFilterSortBar } from "../components/triage/TriageFilterSortBar";
import { NewIssueModal } from "../components/external/NewIssueModal";
import { PageHead } from "../components/common/PageHead";
import { DensityToggle } from "../components/command/DensityToggle";
import {
  selectVisibleDeferredItems,
  selectVisibleOpenItems,
} from "../lib/triageFilterSort";
import { filterTriage } from "../lib/triageApi";
import type { FixNowIntent } from "../components/triage/fixNowIntent";

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

export default function TriagePage() {
  const { data: projects = [] } = useProjects();
  const { data: counts } = useTriageCounts();
  const navigate = useNavigate();
  const { setActiveProjectId } = useProjectFilter();
  // Memoized so `projectIds` below stabilizes across renders when
  // `projects` itself hasn't changed — `projects.filter(...)` alone is a
  // fresh array identity every render (code-reviewer finding). This does
  // NOT make the allItems/availableDomains/aggregate chain skip
  // recomputation on every render — `useAllTriageItems` returns a fresh
  // array of query-observer results each render (no `combine`), so those
  // stay cheap-but-unmemoized derivations; only `projectIds` itself is
  // stable here.
  const realProjects = useMemo(() => projects.filter((p) => !p.synthesized), [projects]);

  // iterate-2026-08-08-triage-filters-sort-parked — view-only filter/sort
  // state (in-memory, no persistence, no store write). `useAllTriageItems`
  // shares its cache entries with each section's own `useTriageItems`
  // (same queryKey — see useTriage.ts) so this costs no extra network
  // calls; it exists only to compute the live Domain filter options and
  // the page-level aggregate hidden-count below.
  const view = useTriageViewState();
  const projectIds = useMemo(() => realProjects.map((p) => p.id), [realProjects]);
  const allItemsQueries = useAllTriageItems(projectIds);
  const allItems = useMemo(
    () => allItemsQueries.flatMap((q) => q.data ?? []),
    [allItemsQueries],
  );
  const availableDomains = useMemo(
    () => [...new Set(allItems.map((it) => it.suggestedDomain))].sort(),
    [allItems],
  );
  // Denominator is openItems+deferredItems (what this tab ever renders),
  // NOT allItems.length — promoted/dismissed items are excluded from
  // both selectors and must not count toward "everything is filtered
  // out", or a project with only promoted/dismissed items would
  // misreport as filtered rather than genuinely empty.
  //
  // hiddenCount counts ONLY attribute-filter-caused hiding (Priority/
  // Domain/Complexity), not Parked's own default-hidden state — deferred
  // items are re-selected with `showParked` forced true so a dated,
  // not-due park (hidden by design, not by an active filter) never counts
  // toward this banner. `view.clearFilters()` resets filters to
  // DEFAULT_FILTER_STATE, whose `showParked` is `false` — it does NOT
  // reveal Parked items, so counting Parked-hidden items here would show
  // "clear filters to see them" copy over a button that does nothing for
  // them (code-reviewer re-review finding NEW-1). The Parked-hidden case
  // already has its own affordance: DeferredTriageSection's own AC7 hint
  // + the Parked filter chip, both per-project and independent of this
  // page-level banner.
  const { hiddenCount: aggregateHiddenCount, relevantCount: aggregateRelevantCount } = useMemo(() => {
    const openItems = filterTriage(allItems);
    const deferredItems = allItems.filter((it) => it.status === "snoozed");
    const openSelection = selectVisibleOpenItems(openItems, view.filters);
    const deferredAttributeOnly = selectVisibleDeferredItems(deferredItems, {
      ...view.filters,
      showParked: true,
    });
    return {
      hiddenCount: openSelection.hiddenCount + deferredAttributeOnly.hiddenCount,
      relevantCount: openItems.length + deferredItems.length,
    };
  }, [allItems, view.filters]);
  // Every relevant item filtered out, but relevant items DO exist — the
  // distinct state from "genuinely nothing is open" (which stays keyed
  // off the unfiltered server counts below, never off what's currently
  // visible — AC5's page-scope correction from plan review).
  const allFilteredOut =
    aggregateRelevantCount > 0 && aggregateHiddenCount === aggregateRelevantCount;

  // FR-01.33 — after Start Campaign / Go to board, focus the board on the
  // campaign's project (so its lane is visible) and navigate to the board ("/").
  const onNavigateToBoard = (projectId: string): void => {
    setActiveProjectId(projectId);
    navigate("/");
  };

  const totalTriage = counts?.total ?? 0;
  // A project can have zero OPEN items yet still show a Deferred section
  // (PerProjectTriageSection renders whenever either is non-empty) — the
  // empty-state banner must stay silent whenever there's anything to look
  // at, parked or not (iterate-2026-08-05-triage-deferred-envelope, code review).
  const totalDeferred = counts?.deferredTotal ?? 0;

  // iterate-2026-05-21 — page-scoped NewIssueModal state. Survives the
  // unmount-on-close of TriageDetailModal (which the `{selected && …}`
  // guard in PerProjectTriageSection performs). The projectId is captured at
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
      {/* A05: shared <PageHead> — 92px anthracite bar. The count keeps its
          load-bearing testid and its real data source (totalTriage). */}
      <PageHead
        title="Triage"
        small={<span data-testid="triage-header-count">({totalTriage})</span>}
        testId="triage-header"
        actions={<DensityToggle />}
      />

      {/* Body — wrapped in .page-container so Triage aligns with Inbox/Projects.
          Top gap matches Projects' 24px (Sven 2026-07-17: equal top padding). */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBlock: "24px 40px" }}
      >
        <div className="page-container density-surface">
          {realProjects.length === 0 ? (
            <p
              className="text-sm text-[var(--muted)]"
              data-testid="triage-no-projects"
            >
              No projects registered. Add a project on the Projects page
              first.
            </p>
          ) : (
            <>
              <TriageFilterSortBar view={view} availableDomains={availableDomains} />
              {realProjects.map((project) => (
                <PerProjectTriageSection
                  key={project.id}
                  project={project}
                  filters={view.filters}
                  sort={view.sort}
                  onFixNow={onFixNow}
                  onNavigateToBoard={onNavigateToBoard}
                />
              ))}
              {/* Genuinely nothing open or parked — stays keyed off the
                  UNFILTERED server counts, never off what's currently
                  visible (AC5's page-scope correction). Checked first: it
                  and allFilteredOut are mutually exclusive by construction
                  (allFilteredOut requires relevant items to exist). */}
              {counts !== undefined && totalTriage === 0 && totalDeferred === 0 && (
                <p
                  className="text-center text-sm text-[var(--muted)] py-8"
                  data-testid="triage-empty-state"
                >
                  No triage items pending. ✓
                </p>
              )}
              {/* Items exist, but the active filters hide every one of
                  them — distinct from the genuine-empty state above, so
                  "nothing is open" and "nothing matches your filter" are
                  never conflated (AC5). "clear filters" is a real button
                  (view.clearFilters, resets filters only, leaves sort
                  alone) — code-reviewer caught the copy promising an
                  affordance the first draft never built. */}
              {allFilteredOut && (
                <p
                  className="text-center text-sm text-[var(--muted)] py-8"
                  data-testid="triage-all-filtered-out"
                >
                  {aggregateHiddenCount} hidden by the active filters —{" "}
                  <button
                    type="button"
                    onClick={view.clearFilters}
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
