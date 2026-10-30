/*
 * AgentsDock - the bottom bar of the Mission chat ("<n> agents running"; shown
 * only while at least one agent is active) plus the modal Agents window it opens
 * (M4). The window also opens from a chat subrunner card, via useMissionAgents.
 * Read-only observer (DO-NOT #1): no composer, no chat-* surface (spec 35).
 */

import { Users } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import { AgentsWindow } from "./AgentsWindow";

export function AgentsDock({ task, controller }: { task: ExternalTask; controller: MissionAgents }) {
  const n = controller.runningCount;
  return (
    <>
      {n > 0 && (
        <div className="mc-agents-bar" data-testid="agents-bar">
          <button
            type="button"
            className="mc-agents-chip"
            onClick={() => controller.openFor()}
            aria-haspopup="dialog"
            data-testid="agents-bar-button"
          >
            <span className="mc-feed-subrunner-dot" aria-hidden="true" />
            <Users size={14} aria-hidden="true" />
            <span>{n === 1 ? "1 agent running" : `${n} agents running`}</span>
          </button>
        </div>
      )}
      <AgentsWindow task={task} controller={controller} />
    </>
  );
}
