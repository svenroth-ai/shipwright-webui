import { useRef, type CSSProperties } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { AnswerInTerminalButton } from "../BubbleTranscript/AnswerInTerminalButton";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import type { ActivityCard, ActivityFeed } from "../../../lib/missionActivityFeed";
import type { CommitArtifact, MergeState } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { formatRelativeTime } from "../../../lib/formatTime";
import { CheckIcon, FeedIcon, FileChipIcon, XIcon } from "./MissionFeedIcons";

interface Props {
  feed: ActivityFeed;
  onArtifactClick?: (artifact: string) => void;
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
  /**
   * Whether this feed is the currently-shown compact panel. Defaults to
   * true for the desktop three-card layout, which never hides this
   * component at all. On a phone, MissionBody mounts the activity panel
   * with `hidden` while the Overview tab is active — a `hidden` element has
   * `scrollHeight` 0, so the mount-time re-pin below is a no-op, and
   * switching TO the Activity tab changes neither `feed.cards.length` nor
   * this component's own DOM node, so the layout effect never re-runs
   * (external code review, openai MEDIUM). Folding visibility into the dep
   * makes the tab switch itself trigger the bottom re-pin.
   */
  visible?: boolean;
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

export function MissionActivityFeed({ feed, onArtifactClick, commitArtifact, task, visible = true }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Opens on the LATEST activity, not the oldest, and keeps following new
  // cards as they arrive (iterate-2026-08-31-mission-feed-gaps) — this
  // container had NO scroll management at all, so a freshly mounted
  // `.mc-feed-scroll` defaulted to the browser's top-of-container start and
  // switching to the Mission tab always landed on the earliest card in the
  // run, no matter how long it had been running. Same CSS-first +
  // `useAutoScroll` safety-net pattern the embedded terminal/transcript uses
  // (DO-NOT #2) rather than a one-shot scroll — this container re-renders on
  // every ~1s transcript poll, so a hand-rolled mount-only effect would fix
  // the initial position but still leave a live run stuck once new cards
  // append below the fold.
  //
  // `visible` rides in the dep string (not a separate effect) so switching
  // TO this compact panel re-pins to bottom too — see the prop's own doc
  // comment for why the mount-time re-pin alone is a no-op on a phone.
  useAutoScroll(scrollRef, `${feed.cards.length}:${visible}`);

  return <section className="mc-op mc-feed" data-testid="operation-card" data-live="true">
    <header className="mc-feed-pinned">
      <span data-testid="mission-feed-outcome">{feed.outcome}</span>
    </header>
    <div ref={scrollRef} className="mc-feed-scroll" role="log" aria-label="Activity feed" tabIndex={0} data-testid="mission-activity-feed">
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
              {/* card.text can carry a turn's own assistant prose (deriveActivityFeed) —
                  assistant/user-influenced content, so it renders through the SAME
                  safe markdown path as the rest of the transcript, never a raw <p>. */}
              <MarkdownChunk content={card.text} />

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
              {card.explanation && <div className="mc-feed-explanation">{card.explanation}</div>}

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
