/*
 * AgentLinkContext - lets markdown rendered inside the Agents window / subrunner panel turn an agent
 * hash into a chip that opens that agent (V3). Outside a provider (inbox, plain transcript, chat)
 * the context is null and markdown renders exactly as before.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { SessionSubagent } from "../../lib/sessionInfoApi";

export interface AgentLinkValue {
  /** Known agent ids (the chips only form for these). */
  ids: readonly string[];
  open: (agentId: string) => void;
}

const AgentLinkContext = createContext<AgentLinkValue | null>(null);
export const useAgentLinks = () => useContext(AgentLinkContext);

export function AgentLinkProvider({ agents, open, children }: { agents: readonly SessionSubagent[]; open: (agentId: string) => void; children: ReactNode }) {
  const ids = useMemo(() => agents.map((a) => a.agentId), [agents]);
  const value = useMemo(() => ({ ids, open }), [ids, open]);
  return <AgentLinkContext.Provider value={value}>{children}</AgentLinkContext.Provider>;
}

/** The clickable hash chip. */
export function AgentChip({ agentId, label }: { agentId: string; label?: string }) {
  const ctx = useAgentLinks();
  const hash = agentId.slice(0, 8);
  // A hand-written agent: link must name a KNOWN agent of this session; anything else stays plain text.
  if (!ctx || !ctx.ids.includes(agentId)) return <>{label || hash}</>;
  return (
    <button type="button" className="hash-link" aria-label={`Open agent ${hash}`} onClick={() => ctx.open(agentId)} data-testid="agent-hash-chip">
      {hash}
    </button>
  );
}
