/*
 * pickSubrunnerAnswer - which text the subrunner panel shows as the agent's report (V3).
 * Never the CLI's "delivered to you as a message" pointer (the reducer already drops it from the
 * card). A failed / killed / stopped agent keeps its notification text (its last message is
 * mid-work prose); otherwise the agent's own last assistant message wins, then the hand-back text
 * the parent received, then whatever the card recorded.
 */

import { isDeliveredPlaceholder } from "./missionActivityFeedSubrunner";
import type { ActivityCard } from "./missionActivityFeedTypes";

export function pickSubrunnerAnswer(
  card: ActivityCard,
  sources: { agentAnswer?: string | null; transcriptAnswer?: string | null; handbackText?: string | null },
): string | null {
  const real = (t: string | null | undefined) => (t && t.trim() && !isDeliveredPlaceholder(t) ? t : null);
  const cardReport = real(card.subrunnerReportFull ?? card.subrunnerReport);
  if (card.subrunnerStatus === "failed" || card.subrunnerEndStatus) {
    return cardReport ?? real(sources.handbackText);
  }
  return real(sources.agentAnswer) ?? real(sources.transcriptAnswer) ?? real(sources.handbackText) ?? cardReport;
}
