import type { CSSProperties } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AnswerInTerminalButton } from "../BubbleTranscript/AnswerInTerminalButton";
import type { ActivityCard, ActivityFeed } from "../../../lib/missionActivityFeed";
import type { CommitArtifact, MergeState } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { CheckIcon, FeedIcon, FileChipIcon, XIcon } from "./MissionFeedIcons";

interface Props {
  feed: ActivityFeed;
  onArtifactClick?: (artifact: string) => void;
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
}

const KIND_LABEL: Record<ActivityCard["kind"], string> = {
  goal: "Goal",
  investigate: "Investigate",
  spec: "Spec",
  implement: "Implement",
  test: "Test",
  review: "Review",
  "user-input": "Question",
  blocker: "Blocker",
  delivery: "Delivered",
  system: "System",
};

/** Icon/node accent — always derived from `card.kind`/`card.status`
 * (MissionContext-sourced), never string-matched from `card.text`. */
function kindAccent(card: ActivityCard): { color: string; line: string } {
  if (card.kind === "blocker") return { color: "var(--err)", line: "var(--err-line)" };
  if (card.kind === "test") {
    return card.status === "ok" ? { color: "var(--ok)", line: "var(--ok-line)" }
      : card.status === "err" ? { color: "var(--err)", line: "var(--err-line)" }
      : card.status === "warn" ? { color: "var(--warn)", line: "var(--warn-line)" }
      : { color: "var(--muted)", line: "var(--line-strong)" };
  }
  if (card.kind === "investigate" || card.kind === "system") return { color: "var(--muted)", line: "var(--line-strong)" };
  return { color: "var(--accent)", line: "var(--accent-line)" };
}

function pillLabel(card: ActivityCard): string | null {
  if (!card.status) return null;
  if (card.kind === "test") return card.status === "ok" ? "Passing" : card.status === "err" ? "Failing" : "Unclear";
  if (card.kind === "blocker") return "Needs attention";
  if (card.kind === "spec") return "Recorded";
  if (card.kind === "review") return "Passed";
  return null;
}

function mergeStateLabel(merge: MergeState): string {
  return merge === "merged" ? "merged" : merge === "pending" ? "pending merge" : "merge state unknown";
}

export function MissionActivityFeed({ feed, onArtifactClick, commitArtifact, task }: Props) {
  return <section className="mc-op mc-feed" data-testid="operation-card" data-live="true">
    <header className="mc-feed-pinned">
      <span className="mc-feed-label">Goal</span>
      <strong data-testid="mission-feed-goal">{feed.goal ?? "No goal has been recorded yet."}</strong>
      <span>{feed.outcome}</span>
    </header>
    <div className="mc-feed-scroll" role="log" aria-label="Activity feed" tabIndex={0} data-testid="mission-activity-feed">
      {feed.cards.length === 0 ? (
        <div className="mc-hero-empty">Waiting — nothing reliable has appeared yet.</div>
      ) : feed.cards.map((card, index) => {
        const isSystem = card.kind === "system";
        const accent = kindAccent(card);
        const pill = pillLabel(card);
        // Gate on artifact === "commit", not just kind === "delivery" (code
        // review catch): a pipeline-finished delivery card links `artifact:
        // "phase"`, not a specific commit — rendering the PR-link card there
        // would surface an unrelated/stale commit's PR from MissionContext.
        const prDetail = card.kind === "delivery" && card.artifact === "commit" ? commitArtifact?.detail : null;
        return (
          <div className="mc-feed-entry" key={`${card.kind}-${index}`}>
            <div
              className="mc-feed-node"
              data-dashed={isSystem ? "true" : undefined}
              style={{ "--kind": accent.color, "--kind-line": accent.line } as CSSProperties}
            >
              <FeedIcon kind={card.kind} />
            </div>
            <article className="mc-feed-card" data-kind={card.kind}>
              {!isSystem && (
                <div className="mc-feed-head">
                  <span className="mc-feed-kind" style={{ "--kind": accent.color } as CSSProperties}>{KIND_LABEL[card.kind]}</span>
                  {pill && (
                    <span className="mc-feed-pill" data-status={card.status}>
                      {card.status === "ok" ? <CheckIcon /> : card.status === "err" ? <XIcon /> : null}
                      {pill}
                    </span>
                  )}
                </div>
              )}
              {/* card.text can carry a turn's own assistant prose (deriveActivityFeed) —
                  assistant/user-influenced content, so it renders through the SAME
                  safe markdown path as the rest of the transcript, never a raw <p>. */}
              <MarkdownChunk content={card.text} />

              {card.question && (
                <div className="mc-feed-qa">
                  {/* The real question prose (external-review catch: options/CTA/
                      answer rendered without ever showing what was actually
                      asked). Assistant-authored, so it goes through the same
                      safe markdown path as card.text — never a raw <p>. */}
                  <div className="mc-feed-qa-question"><MarkdownChunk content={card.question.text} /></div>
                  {card.question.options.length > 0 && (
                    <div className="mc-feed-qa-options">
                      {card.question.options.map((option) => {
                        const picked = card.question!.resolved && card.question!.picked === option;
                        return (
                          <span key={option} className="mc-feed-qa-opt" data-picked={picked ? "true" : undefined}>
                            {picked && <CheckIcon strokeWidth={2.5} />}
                            {option}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {!card.question.resolved ? (
                    <div className="mc-feed-qa-cta"><AnswerInTerminalButton task={task} /></div>
                  ) : !card.question.picked && card.question.answer ? (
                    <div className="mc-feed-qa-answer">{card.question.answer}</div>
                  ) : null}
                </div>
              )}

              {/* card.detail is a bounded, sanitized raw-output excerpt — real tool/
                  terminal content, so it renders as a literal text node (never
                  MarkdownChunk): Markdown-parsing arbitrary terminal output can
                  itself mis-render, and this is never HTML either way. */}
              {card.detail && (
                <div className="mc-feed-code">
                  <pre>{card.detail}</pre>
                </div>
              )}

              {prDetail && (prDetail.prNumber != null || prDetail.prUrl) && (
                <div className="mc-feed-pr">
                  <span className="mc-feed-pr-icon"><FeedIcon kind="delivery" /></span>
                  <span className="mc-feed-pr-body">
                    <span className="mc-feed-pr-title">{prDetail.message ?? "Merged"}</span>
                    <span className="mc-feed-pr-meta">
                      {prDetail.prNumber != null && <span>#{prDetail.prNumber}</span>}
                      <span data-merged={prDetail.merge === "merged" ? "true" : undefined}>{mergeStateLabel(prDetail.merge)}</span>
                    </span>
                  </span>
                </div>
              )}

              {card.artifact && onArtifactClick ? <button type="button" className="mc-story-link" onClick={() => onArtifactClick(card.artifact!)}>Open {card.artifact}</button> : null}
              {card.commands.length ? (
                <div className="mc-feed-chip-row">
                  {card.commands.map((command) => <span className="mc-feed-chip" key={command}><FileChipIcon />{command}</span>)}
                </div>
              ) : null}
            </article>
          </div>
        );
      })}
    </div>
  </section>;
}
