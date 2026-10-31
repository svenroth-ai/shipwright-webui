/**
 * A subagent's hand-back (or another session's message) as its own LEFT feed
 * card — never the human's bubble (campaign mission-desktop-style-v2 V2). The
 * parser (`external/parsers/handback.ts`) has already stripped the English
 * framing; here the sender id is matched to the dispatching subrunner card so
 * the card can carry the delegated work's title.
 */
import type { HandbackEvent } from "../external/session-parser";
import { explanationExcerpt } from "./missionActivityFeedText";
import type { ActivityCard } from "./missionActivityFeedTypes";

export function buildHandbackCard(event: HandbackEvent, cards: readonly ActivityCard[]): ActivityCard | null {
  // An empty report still shows the card: the "not a message from you" notice must not vanish.
  const dispatch = event.sender
    ? cards.find((c) => c.kind === "subrunner" && c.subrunnerId === event.sender)
    : undefined;
  // Sanitising only: the whole report is shown (no "Show more" on chat messages), so no length limit.
  const full = explanationExcerpt(event.text, Infinity, Infinity);
  return {
    kind: "handback",
    text: full,
    commands: [],
    timestamp: event.timestamp,
    handbackSender: event.sender,
    handbackOrigin: event.origin,
    handbackTitle: dispatch?.text,
  };
}
