/**
 * Context compaction in the Mission feed. The CLI writes a `compact_boundary` system record and then
 * the summary of the earlier conversation as a USER-role record. The summary is harness text, never a
 * human bubble: it becomes ONE compact system row ("Context compacted") that carries the summary
 * for a collapsed-by-default "Show summary" toggle (`FeedCompactionRow`).
 */
import { compactSummaryBody, isCompactSummaryContent } from "../external/parsers/compact-summary";
import type { UserEvent } from "../external/session-parser";
import type { ActivityCard } from "./missionActivityFeedTypes";

export const COMPACTED_TEXT = "Context compacted";

export function compactionBoundaryCard(timestamp?: string): ActivityCard {
  return { kind: "system", text: COMPACTED_TEXT, commands: [], timestamp };
}

/** True for the compaction summary user record (the CLI's flag, or the framing fingerprint on older logs). */
export function isCompactSummaryEvent(event: UserEvent): boolean {
  return isCompactSummaryContent(event.content, event.isCompactSummary === true);
}

/** Attaches the summary to the boundary row just before it, or adds a row of its own when none precedes. */
export function addCompactSummary(cards: ActivityCard[], event: UserEvent): void {
  const body = compactSummaryBody(event.content);
  const last = cards[cards.length - 1];
  if (last && last.kind === "system" && last.compactSummary === undefined) {
    if (body) last.compactSummary = body;
    return;
  }
  const card = compactionBoundaryCard(event.timestamp);
  if (body) card.compactSummary = body;
  cards.push(card);
}
