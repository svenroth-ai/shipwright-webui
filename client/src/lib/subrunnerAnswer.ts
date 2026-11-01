/*
 * pickSubrunnerAnswer - which text the subrunner panel shows as the agent's report (V3).
 * Never the CLI's "delivered to you as a message" pointer (the reducer already drops it from the
 * card). A failed / killed / stopped agent keeps its notification text (its last message is
 * mid-work prose); otherwise the hand-back the session received wins (it is the final content of an agent that reports via
 * SubagentHandback), then the session-info answer, the transcript tail, and whatever the card recorded. A running agent has none.
 */

import { isDeliveredPlaceholder } from "./missionActivityFeedSubrunner";
import type { ActivityCard } from "./missionActivityFeedTypes";
import { resolveAgentToken } from "./remarkAgentLinks";

/** Non-blank and not the CLI's "delivered to you" pointer. */
export const isRealAnswer = (t: string | null | undefined): t is string => Boolean(t && t.trim() && !isDeliveredPlaceholder(t));

export function pickSubrunnerAnswer(
  card: ActivityCard,
  sources: { agentAnswer?: string | null; transcriptAnswer?: string | null; handbackText?: string | null },
): string | null {
  const real = (t: string | null | undefined) => (isRealAnswer(t) ? t : null);
  const cardReport = real(card.subrunnerReportFull ?? card.subrunnerReport);
  if (card.subrunnerStatus === "running") return null; // a hand-back sent meanwhile is progress, not the answer
  if (card.subrunnerStatus === "failed" || card.subrunnerEndStatus) {
    return cardReport ?? real(sources.handbackText);
  }
  // Board 4: the agent's last assistant message. An agent that reports through a SubagentHandback call ends with that
  // tool_use, whose INPUT is its final assistant content and is exactly the hand-back the session received; the
  // session-info answer / file tail is then only the prose BEFORE the call. So the hand-back, when one exists for a
  // finished agent, IS the last message; otherwise session-info answer, then the file tail, then the card.
  return real(sources.handbackText) ?? real(sources.agentAnswer) ?? real(sources.transcriptAnswer) ?? cardReport;
}

/** The LAST formal report (origin "subagent") from this agent - plain session messages and coordinator notes are progress, never its answer - or null. */
export function findAgentHandback(cards: readonly ActivityCard[], agentId: string | undefined, knownIds: readonly string[]): ActivityCard | null {
  if (!agentId) return null;
  const full = (s: string) => resolveAgentToken(s, knownIds) ?? s; // a short sender hash only matches its unique known agent
  const want = full(agentId);
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.kind === "handback" && c.handbackOrigin === "subagent" && c.handbackSender && full(c.handbackSender) === want) return c;
  }
  return null;
}
