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
import { useNavigate } from "react-router-dom";
import { InboxProjectSection } from "./inbox/InboxProjectSection";
import { useInboxData } from "./inbox/useInboxData";
import { PageHead } from "../components/common/PageHead";
import { glossaryLookup } from "../lib/glossary";

export default function InboxPage() {
  const { projectGroups, openCount, isLoading, tasksById } = useInboxData();
  const navigate = useNavigate();

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
              className="flex max-w-[600px] flex-col items-start p-6 text-left"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-sm)",
              }}
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
                className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold transition-colors"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  background: "var(--color-bg)",
                }}
              >
                Go to the board
              </button>
            </div>
          )}

          {/* §5.2 contrast fix (A03 ladder): the populated list sits on a SOLID
              neutral sub-panel so body text is never over the bright photo. The
              group headers + session sub-labels use the .on-photo flipping
              --ink/--muted (white on the photo) — reset here to the non-flipping
              stone ramp (the same swap on-photo.css rule 2 does for .card, done
              inline because real components don't carry the .card class), so on
              this white ground every label reads dark-on-white >=4.5:1. Rendered
              ONLY when populated — the empty-state baseline stays untouched. */}
          {projectGroups.length > 0 && (
            <div
              data-testid="inbox-list-panel"
              className="flex flex-col"
              style={{
                gap: "24px",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                padding: "18px 18px 22px",
                boxShadow: "var(--sh-sm)",
                ["--ink" as string]: "var(--g900)",
                ["--body" as string]: "var(--g700)",
                ["--muted" as string]: "var(--g500)",
                ["--faint" as string]: "var(--g400)",
                ["--line" as string]: "var(--g200)",
                ["--line-strong" as string]: "var(--g300)",
              }}
            >
              {projectGroups.map((pg) => (
                <InboxProjectSection
                  key={pg.projectId}
                  group={pg}
                  tasksById={tasksById}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
