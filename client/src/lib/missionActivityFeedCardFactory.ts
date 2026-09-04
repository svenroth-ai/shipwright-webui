/**
 * Card-creation helper for `missionActivityFeed.ts`'s reducer — the `add()`
 * closure that appends a new card or coalesces into the previous one when
 * eligible (same kind/text/artifact). Split out once the reducer file
 * re-crossed the project's 300-line convention while adding the untruncated
 * `xFull` fields (iterate-2026-09-05-mission-feed-ux-gaps) — a self-
 * contained concern (card append/coalesce) separate from the turn-by-turn
 * event loop that calls it.
 */
import { attachCommand } from "./missionActivityFeedText";
import type { ActivityCard, ActivityKind } from "./missionActivityFeedTypes";
import type { ArtifactKind } from "./missionContextApi";

export type CardAdder = (
  kind: ActivityKind,
  text: string,
  command: string,
  artifact?: ArtifactKind,
  coalesce?: boolean,
  timestamp?: string,
  textFull?: string,
  commandFull?: string,
) => ActivityCard;

/** Builds the `add()` closure `deriveActivityFeed` uses to append/coalesce
 *  cards, closing over the caller's own `cards` array and per-card event
 *  count map so both stay a single source of truth for the reducer. */
export function createCardAdder(cards: ActivityCard[], cardEventCounts: Map<ActivityCard, number>): CardAdder {
  return (kind, text, command, artifact, coalesce = true, timestamp, textFull, commandFull) => {
    const previous = cards[cards.length - 1];
    if (coalesce && previous?.kind === kind && previous.text === text && previous.artifact === artifact) {
      attachCommand(previous, command, commandFull ?? command);
      cardEventCounts.set(previous, (cardEventCounts.get(previous) ?? 1) + 1);
      return previous;
    }
    // `timestamp` is set ONLY at creation — a card reused via coalescing above
    // keeps marking when the activity STARTED, not each event folded into it.
    const card: ActivityCard = { kind, text, commands: [], artifact, timestamp };
    attachCommand(card, command, commandFull ?? command);
    if (textFull && textFull.length > text.length) card.textFull = textFull;
    cards.push(card);
    cardEventCounts.set(card, 1);
    return card;
  };
}
