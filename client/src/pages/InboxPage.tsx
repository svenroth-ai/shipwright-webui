/*
 * Inbox — read-only list of pending AskUserQuestion bubbles.
 *
 * C7 split (2026-05-26): page reduced to a thin shell. The logical concerns
 * extracted to client/src/pages/inbox/:
 *   - useInboxData       — session/project grouping + openCount derivation.
 *   - InboxProjectSection — collapsible per-project <details> group.
 *   - InboxCard           — polymorphic dispatcher (with sub-modules
 *                           InboxCard.AskTool + InboxCard.Waiting).
 *   - InboxResumeButton   — "Answer in the terminal" navigation CTA (A19:
 *                           replaced the clipboard-copy path — writes nothing).
 *
 * Iterate 3.7d-b3 (2026-04-22) contract preserved:
 *   - Each card is a LARGER read-only Ask-bubble; option chips display-only.
 *   - No `<textarea>` / freetext input.
 *   - Single brown "Resume/Answer" button per card.
 *   - Whole card click-through → `/tasks/<taskId>`.
 *   - Group-by-project structure + `(N open)` counts preserved.
 *
 * Load-bearing testids (proven by InboxPage.test.tsx 16 cases):
 *   inbox-page, inbox-empty, inbox-session-<uuid>, inbox-item-<toolUseId>,
 *   inbox-task-context-pill-<toolUseId>, inbox-header-count,
 *   inbox-group-project-label-<sessionUuid>-<itemKey> (the session chip),
 *   inbox-project-group-<projectId>, inbox-project-group-toggle-<projectId>,
 *   inbox-group-handle-<projectId>, inbox-group-count-<projectId>,
 *   inbox-group-color-<projectId>, inbox-card-<toolUseId>,
 *   inbox-resume-<toolUseId>.
 *
 * Triage look (iterate-2026-11-13-inbox-triage-look): dark-glass cards, project
 * groups foldable + reorderable (remembered in localStorage), same body box as
 * the Triage page.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { InboxGroupList } from "./inbox/InboxGroupList";
import { useInboxData } from "./inbox/useInboxData";
import { PageHead } from "../components/common/PageHead";
import { useInboxViewState } from "../hooks/useInboxViewState";
import { glossaryLookup } from "../lib/glossary";
import { applyProjectOrder, moveProject } from "../lib/triageProjectOrder";

export default function InboxPage() {
  const { projectGroups, openCount, isLoading, tasksById } = useInboxData();
  const navigate = useNavigate();
  const view = useInboxViewState();

  // The groups follow the user's own project order (drag handle on a group).
  const orderedGroups = useMemo(
    () =>
      applyProjectOrder(
        projectGroups.map((g) => ({ ...g, id: g.projectId })),
        view.projectOrder,
      ),
    [projectGroups, view.projectOrder],
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
          its cards cap at 720px and sit left-aligned. */}
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

          {/* Dark-glass cards (inbox-cards.css) — they carry their own solid
              ground, so there is no neutral panel around the list any more. */}
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
