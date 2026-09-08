/*
 * NeedsYou — a lead's open questions, each with exactly ONE read-only
 * answer-pending field (iterate-2026-09-08-lead-inventory-page, AC-5/AC-11).
 *
 * PO decision 2026-09-07: "no thread, no round three" — anything needing
 * discussion goes to a terminal (card W15 owns that button; if W15 has not
 * landed, the slot is OMITTED entirely rather than building a second one,
 * per Architecture Review). This component is read-only: no answer-write
 * path exists anywhere in this codebase for this data (confirmed by
 * reading `lead-question-threads.ts` and `OrgThread.tsx`) — it links to
 * the existing `/org` thread view (FR-01.71(D)) instead of pretending to
 * be a write surface.
 *
 * "Unanswered" reuses `OrgThread.tsx`'s exact `isAnswered` predicate,
 * inverted (AC-11) — not a new, divergent check. Only a card whose LATEST
 * round is unanswered counts as "needs you"; an answered latest round
 * means the PO already responded, even if an earlier round was open.
 */

import { Link } from "react-router-dom";

import type { OrgThreadCardView } from "../../lib/orgApi";

function isAnswered(round: OrgThreadCardView["rounds"][number]): boolean {
  return typeof round.answer === "string" && round.answer.trim().length > 0;
}

export interface NeedsYouProps {
  cards: OrgThreadCardView[] | undefined;
}

export function NeedsYou({ cards }: NeedsYouProps) {
  const open = (cards ?? []).filter((card) => {
    const latest = card.rounds[card.rounds.length - 1];
    return latest !== undefined && !isAnswered(latest);
  });

  if (open.length === 0) {
    return (
      <p data-testid="needs-you-empty" className="text-[13px] text-[var(--color-muted)]">
        Nothing needs you right now
      </p>
    );
  }

  return (
    <ul data-testid="needs-you-list" className="flex flex-col gap-2">
      {open.map((card) => {
        const latest = card.rounds[card.rounds.length - 1];
        return (
          <li
            key={card.cardId}
            data-testid={`needs-you-card-${card.cardId}`}
            className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="text-[12px] font-medium text-[var(--color-text)]">{card.cardTitle}</div>
            <div className="text-[13px] text-[var(--color-text)]">{latest.question}</div>
            <input
              type="text"
              readOnly
              value=""
              placeholder="Answer pending"
              data-testid="needs-you-answer-field"
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted-bg)] px-2 py-1 text-[12px] text-[var(--color-muted)]"
            />
            <Link
              to="/org"
              data-testid={`needs-you-org-link-${card.cardId}`}
              className="text-[12px] font-medium text-[var(--color-primary)] hover:underline"
            >
              View full conversation on Org
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
