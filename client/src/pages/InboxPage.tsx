/*
 * Inbox — the entries that wait for the operator (awaiting your reply).
 *
 * C7 split (2026-05-26): page reduced to a thin shell. The logical concerns
 * extracted to client/src/pages/inbox/:
 *   - useInboxData        — session/project grouping + openCount derivation.
 *   - InboxFilterBar      — the filter chips (Open / Awaiting reply / Notices).
 *   - InboxProjectSection — one card per project, foldable + reorderable.
 *   - InboxCard           — one entry: InboxRow (compact Triage row) + the
 *                           InboxDetailDialog it opens (full text, actions).
 *   - InboxResumeButton   — "Answer in the terminal" navigation CTA (A19:
 *                           replaced the clipboard-copy path — writes nothing).
 *
 * Compact-row contract (iterate-2026-11-22-w2-inbox-triage-look): one Triage-
 * style row per entry; its hover / focus action is "Answer in the terminal";
 * a click opens the full text in a light dialog (the task is one click further:
 * "Open task"). No `<textarea>` in a row. Group-by-project structure and the
 * `(N open)` count are preserved.
 *
 * Load-bearing testids:
 *   inbox-page, inbox-empty, inbox-session-<uuid>, inbox-item-<toolUseId>,
 *   inbox-header-count, inbox-row-<key>-id (the session id),
 *   inbox-project-group-<projectId>, inbox-project-group-toggle-<projectId>,
 *   inbox-group-handle-<projectId>, inbox-group-count-<projectId>,
 *   inbox-group-color-<projectId>, inbox-card-<key> (the row),
 *   inbox-resume-<key>, inbox-filter-<all|awaiting|notices>.
 *
 * Triage look (iterate-2026-11-13-inbox-triage-look): dark-glass cards, project
 * groups foldable + reorderable (remembered in localStorage), same body box as
 * the Triage page.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InboxFilterBar } from "./inbox/InboxFilterBar";
import { InboxGroupList } from "./inbox/InboxGroupList";
import { countByFilter, filterGroups, type InboxFilter } from "./inbox/inboxRowModel";
import { useInboxData } from "./inbox/useInboxData";
import { PageHead } from "../components/common/PageHead";
import { useInboxViewState } from "../hooks/useInboxViewState";
import { glossaryLookup } from "../lib/glossary";
import { applyProjectOrder, moveProject } from "../lib/triageProjectOrder";

export default function InboxPage() {
  const { projectGroups, openCount, isLoading, tasksById } = useInboxData();
  const navigate = useNavigate();
  const view = useInboxViewState();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const counts = useMemo(() => countByFilter(projectGroups), [projectGroups]);
  // A filter whose last entry just left (polling) falls back to all, never an empty page.
  const activeFilter: InboxFilter = counts[filter] > 0 ? filter : "all";
  // ...and the choice itself is reset, so a later notice does not silently narrow the list again.
  useEffect(() => {
    if (filter !== activeFilter) setFilter(activeFilter);
  }, [filter, activeFilter]);

  // The groups follow the user's own project order (drag handle on a group).
  const orderedGroups = useMemo(
    () =>
      applyProjectOrder(
        filterGroups(projectGroups, activeFilter).map((g) => ({ ...g, id: g.projectId })),
        view.projectOrder,
      ),
    [projectGroups, activeFilter, view.projectOrder],
  );
  const onReorderProject = (movedId: string, overId: string): void => {
    // Move inside the FULL saved order (also projects with no open item today) so they keep their slot.
    const visible = orderedGroups.map((g) => g.projectId);
    const full = [...view.projectOrder, ...visible.filter((id) => !view.projectOrder.includes(id))];
    view.setProjectOrder(moveProject(full, movedId, overId));
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--color-bg)" }}
      data-testid="inbox-page"
    >
      {/* A05: shared <PageHead> — 92px anthracite bar. The "(N open)" count keeps
          its load-bearing testid and its real data source (openCount). */}
      <PageHead
        title="Inbox"
        small={<span data-testid="inbox-header-count">({openCount} open)</span>}
        testId="inbox-header"
      />

      {/* Body — the SAME box as the Triage page (same scroller padding, same
          .page-container), so the content's left edge does not jump when the
          operator switches between the two pages. The Inbox is simply narrower:
          its cards use the full page width like the Triage lanes. */}
      <div className="flex-1 overflow-y-auto pt-4 pb-10 md:pt-6">
        <div className="page-container density-surface">
          {isLoading && (
            // on-photo-legibility: rides bare on the photo → flipping `--muted`.
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Loading…
            </div>
          )}

          {!isLoading && projectGroups.length === 0 && (
            // A07 teaching empty state — copy lifted VERBATIM from the approved
            // prototype (Spec/prototype/screens/inbox.js). One sentence + exactly
            // one action (go to the board, where the running work lives). The
            // "approval gate" jargon carries its glossary explanation right here.
            <div
              className="inbox-card flex !max-w-[600px] flex-col items-start p-6 text-left"
              data-testid="inbox-empty"
            >
              <p
                className="text-lg font-semibold"
                style={{ color: "var(--color-text)" }}
              >
                Your inbox is clear
              </p>
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--color-muted)", lineHeight: 1.55 }}
                data-testid="inbox-empty-sentence"
              >
                When Shipwright needs a decision from you mid-run — a question, or
                an{" "}
                <span
                  data-testid="inbox-empty-gloss-approval-gate"
                  title={glossaryLookup("approval gate")}
                  style={{
                    textDecorationLine: "underline",
                    textDecorationStyle: "dotted",
                    cursor: "help",
                  }}
                >
                  approval gate
                </span>{" "}
                — it lands here so you never have to watch the terminal. Nothing is
                waiting right now.
              </p>
              <button
                type="button"
                onClick={() => navigate("/")}
                data-testid="inbox-empty-cta"
                className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 pointer-coarse:min-h-[44px] text-[13px] font-semibold transition-colors"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  background: "var(--color-muted-bg)",
                }}
              >
                Go to the board
              </button>
            </div>
          )}

          {/* Filter chips, then one dark-glass card per project (inbox-cards.css). */}
          {projectGroups.length > 0 && (
            <InboxFilterBar counts={counts} active={activeFilter} onChange={setFilter} />
          )}
          {projectGroups.length > 0 && (
            <InboxGroupList
              groups={orderedGroups}
              tasksById={tasksById}
              collapsed={view.collapsed}
              onToggle={view.toggleCollapsed}
              onReorderProject={onReorderProject}
            />
          )}
        </div>
      </div>
    </div>
  );
}
