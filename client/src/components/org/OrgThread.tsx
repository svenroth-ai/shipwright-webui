/*
 * OrgThread — the per-card conversation thread on the Org page (FR-04.42,
 * V4c; PO decision, 2026-08-16, §10.6 option (b)). Once a follow-up card
 * starts a round, the rounds live in leadwright's own store — never in the
 * card's `description` field — and this is the ONLY surface that reads
 * them back, round by round, in order (see `useOrgThreads`).
 *
 * Ordering: rounds render in the order the caller supplies. leadwright's
 * store is the ordering authority; this component never re-sorts by
 * timestamp or anything else.
 *
 * Security (FR-04.37): every round text field is untrusted PO/lead text.
 * It renders as a plain React text node only — never markdown, never
 * `dangerouslySetInnerHTML`, never fed through any notification/parsing
 * pipeline (unlike `session-parser`'s `<task-notification>` detection,
 * which this component does not use) — so markup and control sentinels
 * alike render as inert text and never fire a notification.
 */

export interface ThreadRound {
  /** Stable id for React keys and test lookups — not shown to the user. */
  id: string;
  question: string;
  askedAt: string;
  /** Absent (or empty) = no answer yet — renders as an open round, never blank. */
  answer?: string;
  answeredAt?: string;
}

export interface OrgThreadCard {
  cardId: string;
  cardTitle: string;
  rounds: ThreadRound[];
}

/**
 * `typeof ... === "string"` (not `!== undefined`) so a `null` answer — the
 * most likely shape a real, untyped fetch boundary hands back for "not yet
 * answered" — is treated the same as absent, not as a truthy object that
 * then throws on `.length`. `trim()` so a whitespace-only answer doesn't
 * render a visually blank "answered" round (still forbidden by AC-b).
 */
function isAnswered(round: ThreadRound): boolean {
  return typeof round.answer === "string" && round.answer.trim().length > 0;
}

function Round({ round }: { round: ThreadRound }) {
  const answered = isAnswered(round);
  return (
    <li
      className="thread-round"
      data-testid={answered ? "thread-round-answered" : "thread-round-open"}
    >
      <div className="thread-line thread-q">
        <span className="thread-label">Q</span>
        <span className="thread-text">{round.question}</span>
      </div>
      {answered ? (
        <div className="thread-line thread-a">
          <span className="thread-label">A</span>
          <span className="thread-text">{round.answer}</span>
        </div>
      ) : (
        <div className="thread-open" data-testid="thread-round-open-badge">
          Open — waiting for your answer
        </div>
      )}
    </li>
  );
}

/** One follow-up card's thread — question, answer, follow-on question, in order. */
export function OrgThread({ card }: { card: OrgThreadCard }) {
  if (card.rounds.length === 0) return null;
  return (
    <div className="thread" data-testid="org-thread" data-card-id={card.cardId}>
      <div className="thread-title" data-testid="org-thread-title">
        {card.cardTitle}
      </div>
      <ol className="thread-rounds" data-testid="org-thread-rounds">
        {card.rounds.map((round) => (
          <Round key={round.id} round={round} />
        ))}
      </ol>
    </div>
  );
}

/**
 * Every follow-up card for one lead, each with its own ordered thread.
 * Renders nothing at all when there is nothing to show (AC-d) — the
 * default, honest state of every lead until leadwright's round-store
 * producer lands (L8, FR-04.17-FR-04.19).
 */
export function OrgThreadList({ cards }: { cards: OrgThreadCard[] | undefined }) {
  const withRounds = (cards ?? []).filter((c) => c.rounds.length > 0);
  if (withRounds.length === 0) return null;
  return (
    <div className="thread-list" data-testid="org-thread-list">
      {withRounds.map((card) => (
        <OrgThread key={card.cardId} card={card} />
      ))}
    </div>
  );
}
