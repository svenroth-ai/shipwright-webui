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

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjects } from "../hooks/useProjects";
import { useProjectActions } from "../hooks/useProjectActions";
import { useProjectFilter } from "../hooks/useProjectFilter";
import { useTriageCounts } from "../hooks/useTriage";
import { PerProjectTriageSection } from "../components/triage/PerProjectTriageSection";
import { NewIssueModal } from "../components/external/NewIssueModal";
import { PageHead } from "../components/common/PageHead";
import { DensityToggle } from "../components/command/DensityToggle";
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
  const realProjects = projects.filter((p) => !p.synthesized);

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
              {realProjects.map((project) => (
                <PerProjectTriageSection
                  key={project.id}
                  project={project}
                  onFixNow={onFixNow}
                  onNavigateToBoard={onNavigateToBoard}
                />
              ))}
              {counts !== undefined && totalTriage === 0 && totalDeferred === 0 && (
                <p
                  className="text-center text-sm text-[var(--muted)] py-8"
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
