/*
 * SubrunnerPanelHost - the data side of SubrunnerPanel (V3). Resolves the agent's real answer
 * (session-info answer, else the last assistant message of its own transcript file, else the
 * hand-back the parent received, else the card's own report), wires agent-hash chips to the
 * Agents window and the "Jump to message in chat" action. Read-only: no write surface.
 */

import { useCallback, useMemo } from "react";

import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import { findAgentForCard } from "../../../lib/agentsTree";
import { lastAssistantMessage } from "../../../lib/agentTranscriptFeed";
import { formatTokens } from "../../../lib/sessionInfoFormat";
import { findAgentHandback, isRealAnswer, pickSubrunnerAnswer } from "../../../lib/subrunnerAnswer";
import { useSubagentTranscript } from "../../../hooks/useSubagentTranscript";
import { AgentLinkProvider } from "../AgentLinkContext";
import { SubrunnerPanel } from "./SubrunnerPanel";

const cssEscape = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));

function metaLine(agentType: string | null | undefined, durationMs: number | null | undefined, tokens: number | null | undefined): string | null {
  const parts: string[] = [];
  if (agentType) parts.push(agentType);
  if (durationMs != null) {
    const s = Math.round(durationMs / 1000);
    parts.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  }
  if (tokens != null) parts.push(`${formatTokens(tokens)} tokens`);
  return parts.length ? parts.join(" · ") : null;
}

export function SubrunnerPanelHost({ taskId, card, cards, agents, onClose }: {
  taskId: string;
  card: ActivityCard;
  cards: readonly ActivityCard[];
  agents: MissionAgents;
  onClose: () => void;
}) {
  const id = card.subrunnerId;
  const agent = useMemo(() => findAgentForCard(agents.agents, id), [agents.agents, id]);
  const handback = useMemo(() => findAgentHandback(cards, id, agents.agents.map((a) => a.agentId)), [cards, id, agents.agents]);
  // The agent's own file is the source of truth; ask for it only when session-info has no answer for it.
  const finishedOk = card.subrunnerStatus === "done" && !card.subrunnerEndStatus;
  const needFile = Boolean(id) && !isRealAnswer(handback?.text) && !isRealAnswer(agent?.answer) && finishedOk;
  const file = useSubagentTranscript(taskId, agent?.agentId ?? id, needFile, false);
  const fileContent = file.data?.status === "ok" ? file.data.content : null;
  const fileAnswer = useMemo(() => (fileContent ? lastAssistantMessage(fileContent) : null), [fileContent]);
  const answer = pickSubrunnerAnswer(card, { agentAnswer: agent?.answer, transcriptAnswer: fileAnswer, handbackText: handback?.text });

  const openAgent = useCallback((agentId: string) => { agents.openFor(agentId); }, [agents]);
  const canOpen = Boolean(id) && agents.canOpen(id);
  const jump = useCallback(() => {
    const sender = handback?.handbackSender;
    onClose();
    if (!sender) return;
    requestAnimationFrame(() => {
      const all = document.querySelectorAll<HTMLElement>(`[data-testid="mission-activity-feed"] [data-sender="${cssEscape(sender)}"]`);
      const el = all.length ? all[all.length - 1] : null; // the LAST one is the final report shown in the panel
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
    });
  }, [handback, onClose]);

  return (
    <AgentLinkProvider agents={agents.agents} open={openAgent}>
      <SubrunnerPanel
        card={card}
        onClose={onClose}
        answer={answer}
        meta={metaLine(agent?.agentType ?? card.subrunnerType, agent?.durationMs, agent?.tokens)}
        onOpenAgent={canOpen ? () => openAgent(id!) : undefined}
        onJumpToChat={handback ? jump : undefined}
      />
    </AgentLinkProvider>
  );
}
