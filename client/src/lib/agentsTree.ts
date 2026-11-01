/*
 * agentsTree — pure model behind the Agents window (M4): which subagents are
 * Active vs Finished, and "who started whom" (parentAgentId; depth-1 agents are
 * started by the session itself). Data comes from the M2 session-info endpoint.
 *
 * A node whose parent sits in the OTHER section (a finished reviewer under a
 * still-running sub-iterate-runner, or the reverse) becomes a root of its own
 * section, carrying `parentLabel` so the relationship is never lost.
 */

import type { SessionSubagent } from "./sessionInfoApi";

export interface AgentNode {
  agent: SessionSubagent;
  depth: number;
  /** Set for a root whose parent agent lives in the other section. */
  parentLabel: string | null;
}

export interface AgentSections {
  active: AgentNode[];
  finished: AgentNode[];
}

export const isActiveAgent = (a: SessionSubagent) => a.state === "running";

/**
 * The ONE place that decides whether an agent has FINISHED with an answer: the Agents window's Details
 * tab and the chat's report panel both read it (a card's own notification status can lag behind the agent file).
 * running | completed (its last message is its answer) | ended (failed / killed / stopped / no result: last message is mid-work prose).
 */
export type AgentOutcome = "running" | "completed" | "ended";
export const agentOutcome = (a: SessionSubagent): AgentOutcome =>
  a.state === "running" ? "running" : a.status === "completed" ? "completed" : "ended";

export const agentTitle = (a: SessionSubagent): string => a.description || a.agentType || `Agent ${a.agentId.slice(0, 8)}`;

/** completed | failed | killed | stopped | finished-stale | running — the one word shown on a status pill. */
export function agentStatusLabel(a: SessionSubagent): string {
  if (a.state === "running") return "running";
  if (a.state === "finished-stale") return a.status ?? "no result";
  return a.status ?? "finished";
}

/** "ok" | "bad" | "run" | "idle" — drives the pill colour. */
export function agentTone(a: SessionSubagent): "ok" | "bad" | "run" | "idle" {
  if (a.state === "running") return "run";
  if (a.status === "completed") return "ok";
  if (a.status === "failed" || a.status === "killed" || a.status === "stopped") return "bad";
  return "idle";
}

function forest(members: SessionSubagent[], all: Map<string, SessionSubagent>): AgentNode[] {
  const inSet = new Set(members.map((m) => m.agentId));
  const kids = new Map<string, SessionSubagent[]>();
  const roots: SessionSubagent[] = [];
  for (const m of members) {
    const p = m.parentAgentId;
    if (p && p !== m.agentId && inSet.has(p)) (kids.get(p) ?? kids.set(p, []).get(p)!).push(m);
    else roots.push(m);
  }
  const out: AgentNode[] = [];
  const seen = new Set<string>();
  const walk = (a: SessionSubagent, depth: number, isRoot: boolean) => {
    if (seen.has(a.agentId)) return; // a malformed parent cycle can never loop
    seen.add(a.agentId);
    const parent = isRoot && a.parentAgentId ? all.get(a.parentAgentId) : undefined;
    out.push({ agent: a, depth, parentLabel: parent ? agentTitle(parent) : null });
    for (const k of kids.get(a.agentId) ?? []) walk(k, depth + 1, false);
  };
  for (const r of roots) walk(r, 0, true);
  // Members only reachable through a cycle are still listed, as roots.
  for (const m of members) walk(m, 0, true);
  return out;
}

export function buildAgentSections(agents: readonly SessionSubagent[]): AgentSections {
  const all = new Map(agents.map((a) => [a.agentId, a]));
  return {
    active: forest(agents.filter(isActiveAgent), all),
    finished: forest(agents.filter((a) => !isActiveAgent(a)), all),
  };
}

/** The subagent a feed card refers to: by agent id, else (a still-provisional card id) by dispatch tool_use id. */
export function findAgentForCard(agents: readonly SessionSubagent[], subrunnerId: string | undefined): SessionSubagent | null {
  if (!subrunnerId) return null;
  return agents.find((a) => a.agentId === subrunnerId) ?? agents.find((a) => a.toolUseId === subrunnerId) ?? null;
}
