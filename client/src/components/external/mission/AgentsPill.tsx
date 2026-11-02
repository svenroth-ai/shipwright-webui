/*
 * AgentsPill - the "Agents" row of the Info sidebar's Environment card, directly below Remote
 * Control (polish of mission-desktop-style-v2). It replaces the chip that used to sit at the
 * bottom of the Mission chat: the Info sidebar is shared with Files & Terminal, so the Agents
 * window is reachable from both tabs. A text pill, never colour alone: "<n> agents running"
 * (amber, pulsing dot) or "None running" while only finished agents exist. Nothing to show
 * (no agent in this session) -> no row. Read-only observer (DO-NOT #1).
 */

import { Users } from "lucide-react";

import type { MissionAgents } from "../../../hooks/useMissionAgents";

export function agentsLabel(running: number): string {
  if (running === 0) return "None running";
  return running === 1 ? "1 agent running" : `${running} agents running`;
}

export function AgentsPill({ controller }: { controller: MissionAgents }) {
  const n = controller.runningCount;
  if (controller.agents.length === 0) return null;
  return (
    <div className="env-row" data-testid="agents-bar">
      <span className="env-k">Agents</span>
      <span className="env-v">
        <button
          type="button"
          className="env-pill env-pill-btn"
          data-state={n > 0 ? "running" : "idle"}
          onClick={() => controller.openFor()}
          aria-haspopup="dialog"
          data-testid="agents-bar-button"
        >
          {n > 0 ? <span className="mc-feed-subrunner-dot" aria-hidden="true" /> : null}
          <Users size={14} aria-hidden="true" />
          <span>{agentsLabel(n)}</span>
        </button>
      </span>
    </div>
  );
}
