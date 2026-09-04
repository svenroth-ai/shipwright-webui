/**
 * Single-card rendering for `MissionActivityFeed.tsx` — split out once the
 * container crossed the project's 300-line convention while adding the
 * click-to-expand affordances for `textFull`/`explanationFull`/`detailFull`/
 * `question.answerFull`/`commandFullText` (iterate-2026-09-05-mission-feed-
 * ux-gaps: "Nie croppen" — every field the reducer bounds for the compact
 * view gets a full, untruncated counterpart a reader can reveal in place).
 * Modeled on `StopHookCard.tsx`'s collapsed-by-default, `useState`-based
 * expand pattern — no modal, no new library, `aria-expanded` on the toggle.
 */
import { useState, type CSSProperties } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AnswerInTerminalButton } from "../BubbleTranscript/AnswerInTerminalButton";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { CommitArtifact, MergeState } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { formatRelativeTime } from "../../../lib/formatTime";
import { CheckIcon, FeedIcon, FileChipIcon, XIcon } from "./MissionFeedIcons";

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
 * (MissionContext-sourced), never string-matched from `card.text`. Exported
 * so the container (`MissionActivityFeed.tsx`) can color the timeline node
 * with the same accent, without duplicating this switch. */
export function kindAccent(card: ActivityCard): { color: string; line: string } {
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

/**
 * The relative-time chip shared by the system and non-system card headers.
 * Guards `card.timestamp` at render (external code review, LOW): the
 * transcript is explicitly untrusted (routes.ts §5.1) and the session parser
 * only checks `typeof raw.timestamp === "string"`, never that it parses as a
 * date — an unparseable value must render nothing, never the literal text
 * `NaNw ago` a naive render would produce.
 */
function FeedTime({ at }: { at: string }) {
  if (!Number.isFinite(Date.parse(at))) return null;
  return (
    <span className="mc-feed-time" title={new Date(at).toLocaleString()}>
      {formatRelativeTime(at)}
    </span>
  );
}

/** A "Show more"/"Show less" toggle button — purely local expand state, no
 * navigation, so a plain `<button>` (not a link) with `aria-expanded`. */
function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="mc-feed-expand-btn" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? "Show less" : "Show more"}
    </button>
  );
}

export function FeedCard({
  card,
  onArtifactClick,
  commitArtifact,
  task,
}: {
  card: ActivityCard;
  onArtifactClick?: (artifact: string) => void;
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
}) {
  const [textExpanded, setTextExpanded] = useState(false);
  const [explanationExpanded, setExplanationExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const [expandedChip, setExpandedChip] = useState<string | null>(null);

  const isSystem = card.kind === "system";
  const accent = kindAccent(card);
  const pill = pillLabel(card);
  // Gate on artifact === "commit", not just kind === "delivery" (code
  // review catch): a pipeline-finished delivery card links `artifact:
  // "phase"`, not a specific commit — rendering the PR-link card there
  // would surface an unrelated/stale commit's PR from MissionContext.
  const prDetail = card.kind === "delivery" && card.artifact === "commit" ? commitArtifact?.detail : null;

  return (
    <article className="mc-feed-card" data-kind={card.kind}>
      {/* Absent only when the source JSONL event carried no timestamp
          (older transcripts) or the card was synthesized with none —
          never a client-side "now" (iterate-2026-08-31-mission-feed-gaps).
          A `system` card (e.g. "Context automatically compacted.")
          skips the kind label + pill but still gets its own timestamp
          row (external code review, openai MEDIUM) — hiding it there
          left issue #2 unfixed for that one card kind. */}
      {!isSystem ? (
        <div className="mc-feed-head">
          <span className="mc-feed-kind-row">
            <span className="mc-feed-kind" style={{ "--kind": accent.color } as CSSProperties}>{KIND_LABEL[card.kind]}</span>
            {card.timestamp && <FeedTime at={card.timestamp} />}
          </span>
          {pill && (
            <span className="mc-feed-pill" data-status={card.status}>
              {card.status === "ok" ? <CheckIcon /> : card.status === "err" ? <XIcon /> : null}
              {pill}
            </span>
          )}
        </div>
      ) : (
        card.timestamp && (
          <div className="mc-feed-head mc-feed-head-system">
            <FeedTime at={card.timestamp} />
          </div>
        )
      )}
      {/* card.text can be empty (a card whose turn wrote no narration of its
          own — no more generic bucket sentence, iterate-2026-09-05-mission-
          feed-ux-gaps): the card then renders only its command chip(s)/
          detail below. When present it can carry a turn's own assistant
          prose — assistant/user-influenced content, so it renders through
          the SAME safe markdown path as the rest of the transcript, never
          a raw <p>. */}
      {card.text && (
        <>
          <MarkdownChunk content={textExpanded && card.textFull ? card.textFull : card.text} />
          {card.textFull && <ExpandToggle expanded={textExpanded} onToggle={() => setTextExpanded((v) => !v)} />}
        </>
      )}

      {/* card.explanation is one turn's own words beyond its headline —
          not always the card's own tool-calling turn (it may be the
          immediately preceding narration-only turn's, per FR-01.68 (S),
          amended iterate-2026-08-27-mission-feed-narration-scroll) — a
          bounded, sanitized excerpt, not markdown: rendered as a
          literal text node reusing `.mc-feed-qa-answer`'s exact
          style (same margin/font-size/color), never MarkdownChunk —
          `card.text` is always single-line today, so this would be
          the first markdown BLOCK content ever shown inside a feed
          card, and the feed's CSS supports only inline elements
          there (Internal Plan Review finding). `.mc-feed-explanation`
          adds only `white-space: pre-wrap` on top of that shared
          style, so multi-line text wraps correctly without
          touching the existing question-answer rule at all. */}
      {card.explanation && (
        <div className="mc-feed-explanation">
          {explanationExpanded && card.explanationFull ? card.explanationFull : card.explanation}
          {card.explanationFull && <ExpandToggle expanded={explanationExpanded} onToggle={() => setExplanationExpanded((v) => !v)} />}
        </div>
      )}

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
            // Marked with an explicit "Answer:" label so an unpicked-option
            // resolution isn't mistaken for more question prose (reported:
            // "die antwort nicht als antwort markiert",
            // iterate-2026-09-05-mission-feed-ux-gaps) — same never-crop
            // contract as every other bounded field.
            <div className="mc-feed-qa-answer">
              <span className="mc-feed-qa-answer-label">Answer:</span>{" "}
              {answerExpanded && card.question.answerFull ? card.question.answerFull : card.question.answer}
              {card.question.answerFull && <ExpandToggle expanded={answerExpanded} onToggle={() => setAnswerExpanded((v) => !v)} />}
            </div>
          ) : null}
        </div>
      )}

      {/* card.detail is a bounded, sanitized raw-output excerpt — real tool/
          terminal content, so it renders as a literal text node (never
          MarkdownChunk): Markdown-parsing arbitrary terminal output can
          itself mis-render, and this is never HTML either way. */}
      {card.detail && (
        <div className="mc-feed-code">
          <pre>{detailExpanded && card.detailFull ? card.detailFull : card.detail}</pre>
          {card.detailFull && <ExpandToggle expanded={detailExpanded} onToggle={() => setDetailExpanded((v) => !v)} />}
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
          {card.commands.map((command) => {
            // A chip is clickable only when there is real, longer content
            // behind it — reported: "die Befehle kann ich gar nicht
            // anschauen" (a long Bash command could not be inspected past
            // its truncated preview), iterate-2026-09-05-mission-feed-ux-gaps.
            const full = card.commandFullText?.[command];
            if (!full) return <span className="mc-feed-chip" key={command}><FileChipIcon />{command}</span>;
            const open = expandedChip === command;
            return (
              <span className="mc-feed-chip-wrap" key={command}>
                <button
                  type="button"
                  className="mc-feed-chip mc-feed-chip-clickable"
                  aria-expanded={open}
                  onClick={() => setExpandedChip(open ? null : command)}
                >
                  <FileChipIcon />{command}
                </button>
                {open && (
                  <div className="mc-feed-chip-detail">
                    <pre>{full}</pre>
                  </div>
                )}
              </span>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
