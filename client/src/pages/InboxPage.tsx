/*
 * Inbox — read-only list of pending AskUserQuestion bubbles.
 *
 * C7 split (2026-05-26): page reduced to a thin shell. The logical concerns
 * extracted to client/src/pages/inbox/:
 *   - useInboxData       — session/project grouping + openCount derivation.
 *   - InboxProjectSection — collapsible per-project <details> group.
 *   - InboxCard           — polymorphic dispatcher (with sub-modules
 *                           InboxCard.AskTool + InboxCard.Waiting).
 *   - InboxResumeButton   — Answer/Resume CTA + clipboard copy.
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
 *   inbox-group-project-label-<sessionUuid>,
 *   inbox-project-group-<projectId>, inbox-project-group-toggle-<projectId>,
 *   inbox-group-color-<projectId>, inbox-card-<toolUseId>,
 *   inbox-resume-<toolUseId>, inbox-copy-resume-<toolUseId>.
 */
import { InboxProjectSection } from "./inbox/InboxProjectSection";
import { useInboxData } from "./inbox/useInboxData";
import { PageHead } from "../components/common/PageHead";

export default function InboxPage() {
  const { projectGroups, openCount, isLoading, tasksById } = useInboxData();

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

      {/* Body — wrapped in .page-container so Inbox aligns with Projects */}
      <div className="flex-1 overflow-y-auto" style={{ paddingBlock: "12px 40px" }}>
        <div className="page-container">
          {isLoading && (
            <div className="text-sm" style={{ color: "var(--color-muted)" }}>
              Loading…
            </div>
          )}

          {!isLoading && projectGroups.length === 0 && (
            <div
              className="p-4 text-sm"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-button)",
                color: "var(--color-muted)",
              }}
              data-testid="inbox-empty"
            >
              No pending interactions.
            </div>
          )}

          <div className="flex flex-col" style={{ gap: "24px" }}>
            {projectGroups.map((pg) => (
              <InboxProjectSection
                key={pg.projectId}
                group={pg}
                tasksById={tasksById}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
