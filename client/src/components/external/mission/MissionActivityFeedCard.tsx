/**
 * Single-card rendering for `MissionActivityFeed.tsx`, split out at the 300-line
 * convention. EVERY `*Full` field gets a click-to-expand toggle ("Nie croppen",
 * iterate-2026-09-05) — text, explanation, detail, answer and command. */
import { useState } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AnswerInTerminalButton } from "../BubbleTranscript/AnswerInTerminalButton";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { CheckIcon, XIcon } from "./MissionFeedIcons";
import { FeedCommands } from "./MissionActivityFeedCommands";
import { ExpandToggle, mergeStateLabel, pillLabel } from "./MissionActivityFeedCardParts";
import { stripDuplicateSentence } from "../../../lib/missionActivityFeedText";

export { kindAccent } from "./MissionActivityFeedCardParts";

export function FeedCard({
  card,
  onArtifactClick,
  onSubrunnerClick,
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
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
}) {
  const [textExpanded, setTextExpanded] = useState(false);
  const [explanationExpanded, setExplanationExpanded] = useState(false);
  // 40th (glm, low), DECLINED as unreachable, re-noted 71st: shared with the
  // non-blocker `card.detail` <pre>, but a kind change REMOUNTS (kind-first key).
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [answerExpanded, setAnswerExpanded] = useState(false);
  // FULL untruncated detail, separate from `detailExpanded` (open vs. not),
  // 26th (glm, medium): one state dumped the traceback on every open.
  const [blockerDetailFullyExpanded, setBlockerDetailFullyExpanded] = useState(false);

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
  const showText = displayText.length > 0;
  // Clamped on `commands.length` (73rd, glm, low) — what `FeedCommands` gates
  // on, so a `commandCount > 0` card with an EMPTY `commands` can no longer
  // promise "N commands" and expand to no chips. Rounds 47/57/72 declined it as
  // unreachable and that trace holds; the 73rd applies this codebase's OWN
  // 43rd-round principle (a mechanical guard beats an argued invariant).
  const blockerCommandCount = card.commands.length > 0 ? card.commandCount ?? card.commands.length : 0;

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
          `textLiteral` (only the blocker's synthesized "A command failed: …"
          sentence) renders as a literal text node — markdown-significant
          characters in a raw error line would garble it (17th, glm, low). Gated
          on the explicit flag, not `kind === "blocker"` (18th, glm, medium).
          82nd (glm, low), FIXED with a MECHANICAL guard where the invariant had
          only been ARGUED in `…Resolve.ts` comments: the literal branch ignored
          `textFull`, so a card carrying BOTH lost the never-crop affordance.
          The reducer deletes `textFull` at both mutation sites, so no
          production render changes — the renderer stops depending on that.
          Expanding, not glm's "drop `textFull`", is what "nie croppen" asks,
          and the text stays a React text child, so still inert.
          `showText` (not bare `card.text`) additionally suppresses only the
          EXACT PR-title-duplicate sentence — see `prDuplicateText` above. */}
      {showText && (
        card.textLiteral ? (
          <>
            <p>{textExpanded && displayTextFull ? displayTextFull : displayText}</p>
            {card.textFull && <ExpandToggle expanded={textExpanded} onToggle={() => setTextExpanded((v) => !v)} />}
          </>
        ) : (
          <>
            <MarkdownChunk content={textExpanded && displayTextFull ? displayTextFull : displayText} />
            {card.textFull && <ExpandToggle expanded={textExpanded} onToggle={() => setTextExpanded((v) => !v)} />}
          </>
        )
      )}

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
          <MarkdownChunk content={explanationExpanded && card.explanationFull ? card.explanationFull : card.explanation} />
          {card.explanationFull && <ExpandToggle expanded={explanationExpanded} onToggle={() => setExplanationExpanded((v) => !v)} />}
        </div>
      )}

      {card.question && (
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
              {answerExpanded && card.question.answerFull ? card.question.answerFull : card.question.answer}
              {card.question.answerFull && <ExpandToggle expanded={answerExpanded} onToggle={() => setAnswerExpanded((v) => !v)} />}
            </div>
          ) : null}
        </div>
      )}

      {/* card.detail is a bounded, sanitized raw-output excerpt — real tool/
          terminal content, a literal text node, never MarkdownChunk. A
          blocker's detail is a raw traceback a reader cannot act on at a
          glance (reported: "steht keine Lösung, nur der Bash-Befehl",
          iterate-2026-09-16-mission-feed-render-fidelity); `card.text` above
          carries the plain explanation, so the excerpt collapses behind "Show
          details". The failing command renders INSIDE that same disclosure,
          PRE-EXPANDED — one click reveals both (5th/6th, both, medium). */}
      {card.kind === "blocker" && (card.detail || blockerCommandCount > 0) ? (
        // Keyed on `card.kind === "blocker"` FIRST, not on `card.detail` (15th,
        // glm, low): a blocker with no error output, or an `add()`-coalesced
        // multi-command ambiguity skipping `attachDetail`, fell through to the
        // doubly-collapsed generic `FeedCommands`. Rounds 28/34 argued a "dead"
        // toggle was unreachable; it survived (35th, low) — now GUARDED on
        // `card.detail || blockerCommandCount > 0`.
        <div className="mc-feed-code">
          <button
            type="button"
            className="mc-feed-expand-btn mc-feed-code-toggle"
            aria-expanded={detailExpanded}
            // 46th (glm, low), FIXED: closing the disclosure left
            // `blockerDetailFullyExpanded` set, so RE-opening dumped the whole
            // traceback, not the bounded excerpt. Each open starts bounded.
            // (Duplicated by a copy slip - 47th, glm, low, FIXED.)
            // 51st (glm, low), FIXED: the reset lived INSIDE the
            // `setDetailExpanded` updater, which React may invoke twice
            // (StrictMode) and requires to be side-effect-free.
            onClick={() => {
              if (detailExpanded) setBlockerDetailFullyExpanded(false);
              setDetailExpanded((v) => !v);
            }}
          >
            {/* Folds the count into this SAME toggle for REVEALING the commands —
                no double-click (25th/26th, openai, medium). `FeedCommands` below
                still mounts its own (pre-expanded, "Hide commands") toggle once
                open — a second control, just not one needed to reveal anything
                (31st, glm, low; re-raised 66th and 70th, both reaching the same
                conclusion — STANDS: a bare row would drop the re-collapse
                affordance every card kind has). */}
            {/* A `commandCount > 0` card with an empty `commands` cannot promise
                chips it has none of — rounds 47/57/72 declined that as
                unreachable (`attachCommand` is the sole writer of both), and the
                73rd made it mechanical anyway; see `blockerCommandCount`. */}
            {detailExpanded ? "Hide details" : blockerCommandCount > 0 ? `Show details (${blockerCommandCount} command${blockerCommandCount === 1 ? "" : "s"})` : "Show details"}
          </button>
          {detailExpanded && (
            <>
              {card.detail && (
                <>
                  <pre>{blockerDetailFullyExpanded && card.detailFull ? card.detailFull : card.detail}</pre>
                  {card.detailFull && <ExpandToggle expanded={blockerDetailFullyExpanded} onToggle={() => setBlockerDetailFullyExpanded((v) => !v)} />}
                </>
              )}
              <FeedCommands commands={card.commands} commandCount={card.commandCount} commandFullText={card.commandFullText} defaultExpanded />
            </>
          )}
        </div>
      ) : card.detail ? (
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

      {/* A delegated subagent's own status/report affordance
          (iterate-2026-09-26-mission-tab-subrunner). Running renders a
          pulsing dot — motion tokens, no magic numbers (CLAUDE.md A20) —
          that the global reduced-motion floor (`motion.css`) settles to its
          final visible frame, never hidden content. Done/failed open the
          right-side panel via `onSubrunnerClick`, worded distinctly (external
          code review, openai, medium: "the same button whether they
          succeeded or failed" made the done/failed distinction invisible) —
          a caller that never wires that prop up renders the report inline
          instead, since there is then nothing a click could open. */}
      {card.kind === "subrunner" && (
        card.subrunnerStatus === "running" ? (
          <p className="mc-feed-subrunner-status" data-status="running">
            <span className="mc-feed-subrunner-dot" aria-hidden="true" />Running…
          </p>
        ) : card.subrunnerId && onSubrunnerClick ? (
          <button type="button" className="mc-story-link" onClick={() => onSubrunnerClick(card.subrunnerId!)}>
            {card.subrunnerStatus === "failed" ? <XIcon /> : <CheckIcon />}
            {card.subrunnerStatus === "failed" ? "View failure details" : "View subrunner report"}
          </button>
        ) : card.subrunnerReport ? (
          <MarkdownChunk content={card.subrunnerReport} />
        ) : null
      )}

      {card.artifact && onArtifactClick ? <button type="button" className="mc-story-link" onClick={() => onArtifactClick(card.artifact!)}>Open {card.artifact}</button> : null}
      {/* A blocker renders its command(s) inside "Show details" above. */}
      {card.kind !== "blocker" && <FeedCommands commands={card.commands} commandCount={card.commandCount} commandFullText={card.commandFullText} />}
    </article>
  );
}
