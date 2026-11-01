/*
 * pickSubrunnerAnswer - which text the subrunner panel shows as the agent's report (V3).
 * Never the CLI's "delivered to you as a message" pointer (the reducer already drops it from the
 * card). A failed / killed / stopped agent keeps its notification text (its last message is
 * mid-work prose); otherwise the hand-back text the parent received wins, then the agent's own last
 * assistant message, then the transcript tail, then whatever the card recorded.
 */

import { isDeliveredPlaceholder } from "./missionActivityFeedSubrunner";
import type { ActivityCard } from "./missionActivityFeedTypes";

/** Non-blank and not the CLI's "delivered to you" pointer. */
export const isRealAnswer = (t: string | null | undefined): t is string => Boolean(t && t.trim() && !isDeliveredPlaceholder(t));

export function pickSubrunnerAnswer(
  card: ActivityCard,
  sources: { agentAnswer?: string | null; transcriptAnswer?: string | null; handbackText?: string | null },
): string | null {
  const real = (t: string | null | undefined) => (isRealAnswer(t) ? t : null);
  const cardReport = real(card.subrunnerReportFull ?? card.subrunnerReport);
  if (card.subrunnerStatus === "failed" || card.subrunnerEndStatus) {
    return cardReport ?? real(sources.handbackText);
  }
  // The hand-back is the report the session actually received; the agent's last message may be mid-work narration
  // when it reported through a SubagentHandback call (V3 doubt O3).
  return real(sources.handbackText) ?? real(sources.agentAnswer) ?? real(sources.transcriptAnswer) ?? cardReport;
}
