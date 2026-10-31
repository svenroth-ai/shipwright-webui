/**
 * Single-card rendering for `MissionActivityFeed.tsx`, split out at the 300-line
 * convention. Agent/user message text, explanation and answer render IN FULL
 * (campaign mission-desktop-style-v2 V1: "Show more" on a chat message is
 * pointless); only raw tool output (`detail`, command chips) keeps a
 * click-to-expand toggle. */
import { useState } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AnswerInTerminalButton } from "../BubbleTranscript/AnswerInTerminalButton";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { CheckIcon, XIcon } from "./MissionFeedIcons";
import { FeedCommands } from "./MissionActivityFeedCommands";
import { AskAnswerCards } from "./MissionAskCards";
import { ExpandToggle, mergeStateLabel, pillLabel } from "./MissionActivityFeedCardParts";
import { stripDuplicateSentence } from "../../../lib/missionActivityFeedText";
import { HandbackCard } from "../HandbackCard";
import { SubrunnerRow } from "./SubrunnerRow";

export function FeedCard({
  card,
  onArtifactClick,
  onSubrunnerClick,
  canOpenAgent,
  commitArtifact,
  task,
}: {
  card: ActivityCard;
  onArtifactClick?: (artifact: string) => void;
  /** Opens the right-side panel for a resolved subrunner card
   *  (iterate-2026-09-26-mission-tab-subrunner). Every subrunner card always
   *  carries a `subrunnerId` (set at dispatch, in `createSubrunnerDispatchCard`);
   *  a caller that omits this prop entirely still sees the report, rendered
   *  inline instead since there is then nothing a click could open. */
  onSubrunnerClick?: (subrunnerId: string) => void;
  /** M4: a still-running card gets a "View agent" button once its agent is known to session-info. */
  canOpenAgent?: (subrunnerId: string) => boolean;
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
}) {
  const [detailExpanded, setDetailExpanded] = useState(false);

  // V2: a delegated subagent is its own compact row, a hand-back its own left card.
  if (card.kind === "subrunner") {
    return <SubrunnerRow card={card} onSubrunnerClick={onSubrunnerClick} canOpenAgent={canOpenAgent} />;
  }
  if (card.kind === "handback") {
    const sender = card.handbackSender ?? "";
    return (
      <HandbackCard
        className="mc-feed-card"
        tableWrap
        origin={card.handbackOrigin ?? "session"}
        sender={sender}
        text={card.text}
        title={card.handbackTitle}
        onSenderClick={sender && onSubrunnerClick && canOpenAgent?.(sender) ? onSubrunnerClick : undefined}
      />
    );
  }

  const pill = pillLabel(card);
  // Gate on artifact === "commit", not just kind === "delivery" (code review
  // catch): a `artifact: "phase"` delivery would surface an unrelated PR.
  const prDetail = card.kind === "delivery" && card.artifact === "commit" ? commitArtifact?.detail : null;
  // The ONLY suppressed sentence (iterate-2026-09-26-mission-tab-subrunner,
  // Sven's correction — "nicht alles was geprintet ist hidden wird"): a
  // sentence-level, whitespace-tolerant match against the synthesized
  // "Merged as ...\"." sentence `missionActivityFeedReconcile.ts` writes
  // whenever a commit message is available, which says nothing the PR box's
  // own title (same text) doesn't already say — stripped even when it's
  // embedded in a longer narrative, not only when it's the card's WHOLE text
  // (external code review, both providers, medium: the first cut required
  // whole-text equality and left an embedded duplicate sentence unstripped).
  // Any other real narrative — including a DIFFERENT sentence on the same
  // card — stays fully visible.
  const prDuplicateText = prDetail?.message ? `Merged as "${prDetail.message}".` : null;
  const displayText = stripDuplicateSentence(card.text, prDuplicateText);
  const displayTextFull = card.textFull ? stripDuplicateSentence(card.textFull, prDuplicateText) : card.textFull;
  // Local PR-review preflight (BLOCK, 2026-09-26): `displayText` alone misses
  // the case where card.text IS the whole duplicate sentence (strips to "")
  // but card.textFull carries real narration beyond it — that content must
  // stay visible (text now renders in full) rather than disappearing along with
  // the duplicate-only short text.
  // An answered question renders as per-question answer cards (M5): the templated
  // "input was received" sentence adds nothing there, and the legacy block is replaced.
  const askItems = card.question?.resolved ? card.question.items : undefined;
  const showText = !askItems && (displayText.length > 0 || Boolean(displayTextFull && displayTextFull.length > 0));
  return (
    <article className="mc-feed-card" data-kind={card.kind}>
      {/* Kind label + per-card timestamp both removed site-wide
          (iterate-2026-09-26-mission-tab-subrunner) — the timeline node's
          icon + color already convey kind, and a one-time "Session started"
          divider (`MissionActivityFeed.tsx`) replaces per-card time. The
          header row now renders only the status pill, when one exists. */}
      {pill && (
        <div className="mc-feed-head">
          <span className="mc-feed-pill" data-status={card.status}>
            {card.status === "ok" ? <CheckIcon /> : card.status === "err" ? <XIcon /> : null}
            {pill}
          </span>
        </div>
      )}
      {/* card.text can be empty (a turn wrote no narration of its own) — then
          only commands / detail render below. When present it takes the same
          safe markdown path as the rest of the transcript, never a raw <p>.
          `showText` (not bare `card.text`) additionally suppresses only the
          EXACT PR-title-duplicate sentence — see `prDuplicateText` above. */}
      {showText && <MarkdownChunk tableWrap content={displayTextFull || displayText} />}

      {/* card.explanation is one turn's own words beyond its headline — not
          always the card's own tool-calling turn (FR-01.68 (S), amended
          iterate-2026-08-27) — a bounded, sanitized excerpt of assistant prose
          through the same safe markdown path as `card.text` (reported:
          table/headers/bold showed as raw source, this iterate). Old
          `white-space: pre-wrap` removed — MarkdownChunk owns the structure.
          34th-round catch (glm, medium), DECLINED: a SOFT break (lone `\n`) now
          renders as a space per CommonMark, where `pre-wrap` showed a real
          break. Probed: the `\n` survives into the `<p>`, but stray inter-block
          `\n` nodes would become blank lines under `pre-wrap`; real fixes are out
          of proportion (`remark-breaks` absent, `MarkdownText` SHARED). */}
      {card.explanation && (
        <div className="mc-feed-explanation">
          <MarkdownChunk tableWrap content={card.explanationFull || card.explanation} />
        </div>
      )}

      {askItems && askItems.length > 0 && <AskAnswerCards items={askItems} />}

      {card.question && !(askItems && askItems.length > 0) && (
        <div className="mc-feed-qa">
          {/* The real question prose (external-review catch: options/CTA/
              answer rendered without ever showing what was actually asked).
              Assistant-authored, so it takes the same safe markdown path as
              card.text — never a raw <p>. */}
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
            // Explicit "Answer:" label so an unpicked-option resolution isn't
            // mistaken for more question prose (reported: "die antwort nicht
            // als antwort markiert") — same never-crop contract as the rest.
            <div className="mc-feed-qa-answer">
              <span className="mc-feed-qa-answer-label">Answer:</span>{" "}
              {card.question.answerFull || card.question.answer}
            </div>
          ) : null}
        </div>
      )}

      {/* card.detail is a bounded, sanitized raw-output excerpt — real tool/
          terminal content (a failing test run), a literal text node, never
          MarkdownChunk. */}
      {card.detail ? (
        <div className="mc-feed-code">
          <pre>{detailExpanded && card.detailFull ? card.detailFull : card.detail}</pre>
          {card.detailFull && <ExpandToggle expanded={detailExpanded} onToggle={() => setDetailExpanded((v) => !v)} />}
        </div>
      ) : null}

      {prDetail && (prDetail.prNumber != null || prDetail.prUrl) && (
        <div className="mc-feed-pr">
          {/* Green checkmark, not the two-circle "delivery" glyph (Sven:
              "Icon könnte ein grüner Haken sein"). */}
          <span className="mc-feed-pr-icon"><CheckIcon /></span>
          <span className="mc-feed-pr-body">
            <span className="mc-feed-pr-title">{prDetail.message ?? "Merged"}</span>
            <span className="mc-feed-pr-meta">
              {prDetail.prNumber != null && <span className="mc-feed-pr-number">#{prDetail.prNumber}</span>}
              <span data-merged={prDetail.merge === "merged" ? "true" : undefined}>{mergeStateLabel(prDetail.merge)}</span>
            </span>
          </span>
        </div>
      )}

      {card.artifact && onArtifactClick ? <button type="button" className="mc-story-link" onClick={() => onArtifactClick(card.artifact!)}>Open {card.artifact}</button> : null}
      <FeedCommands commands={card.commands} commandCount={card.commandCount} commandFullText={card.commandFullText} />
    </article>
  );
}
