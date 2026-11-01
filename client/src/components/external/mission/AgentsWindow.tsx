/*
 * AgentsWindow - the modal Agents window (M4): Radix Dialog (focus trap, Esc,
 * backdrop close). Left: the Active / Finished tree; right: the selected
 * agent's detail. Fed by useMissionAgents (session-info); the Refresh button is
 * the manual refetch (there is no timer - the endpoint rescans per request).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, RefreshCw, X } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import { buildAgentSections } from "../../../lib/agentsTree";
import { AgentDetail } from "./AgentDetail";
import { AgentsList } from "./AgentsList";
import { AgentLinkProvider } from "../AgentLinkContext";

export function AgentsWindow({ task, controller }: { task: ExternalTask; controller: MissionAgents }) {
  const { agents, open, selectedId, select } = controller;
  const sections = useMemo(() => buildAgentSections(agents), [agents]);
  const first = sections.active[0] ?? sections.finished[0] ?? null;
  const selected = agents.find((a) => a.agentId === selectedId) ?? first?.agent ?? null;
  const parent = selected?.parentAgentId ? (agents.find((a) => a.agentId === selected.parentAgentId) ?? null) : null;
  // Phone: the list and the detail are two steps. Opening on a chosen agent (a chat card, a hash chip)
  // lands on its detail; opening from the bar lands on the list. Wide screens show both (CSS ignores it).
  const [drilled, setDrilled] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDrilled(selectedId !== null);
  }
  const pick = (agentId: string) => {
    select(agentId);
    setDrilled(true);
  };
  // Keyboard users follow the drill-down: into the detail -> its Back button, Back -> the row they came from.
  // Only a VISIBLE target takes focus (on a wide screen Back is hidden and the row keeps it).
  const winRef = useRef<HTMLDivElement>(null);
  const drillSeen = useRef(drilled);
  useEffect(() => {
    if (drillSeen.current === drilled) return;
    drillSeen.current = drilled;
    const target = winRef.current?.querySelector<HTMLElement>(drilled ? ".ag-back" : '.ag-row[data-selected="true"]');
    if (target && target.offsetParent !== null) target.focus();
  }, [drilled]);
  useEffect(() => {
    // Opening with nothing chosen lands on the first agent, so the detail pane is never blank.
    if (open && selectedId === null && first) select(first.agent.agentId);
  }, [open, selectedId, first, select]);

  return (
    <AgentLinkProvider agents={agents} open={select}>
    <Dialog.Root open={open} onOpenChange={controller.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ag-overlay" />
        <Dialog.Content ref={winRef} className="ag-window" aria-describedby={undefined}
          data-testid="agents-window"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // The opener can be gone (the bar hides at 0 running): fall back to the feed, never <body>.
            const el = controller.returnFocusRef.current;
            const target = el?.isConnected ? el : document.querySelector<HTMLElement>('[data-testid="mission-activity-feed"]');
            target?.focus();
          }}
        >
          <header className="ag-head">
            {drilled && agents.length > 0 && (
              <button type="button" className="ag-icon-btn ag-back" onClick={() => setDrilled(false)} aria-label="Back to the agents list" data-testid="agents-back">
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
            )}
            <Dialog.Title className="ag-title">Agents</Dialog.Title>
            <span className="ag-head-sub" data-testid="agents-summary">
              {controller.runningCount} running {"·"} {agents.length} total
            </span>
            <button type="button" className="ag-icon-btn" onClick={controller.refresh} aria-label="Refresh agents" data-testid="agents-refresh">
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            <Dialog.Close asChild>
              <button type="button" className="ag-icon-btn" aria-label="Close" data-testid="agents-close">
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          {agents.length === 0 ? (
            <p className="ag-empty ag-empty-main" data-testid="agents-empty">
              {controller.failed ? "Could not load the agents." : controller.loading ? "Loading agents..." : "No agents have run in this session."}
            </p>
          ) : (
            <div className="ag-body" data-view={drilled ? "detail" : "list"}>
              <AgentsList sections={sections} selectedId={selected?.agentId ?? null} onSelect={pick} />
              {selected && <AgentDetail key={selected.agentId} task={task} agent={selected} parent={parent} controller={controller} report={controller.reportFor(selected.agentId)} handback={controller.handbackFor(selected.agentId)} />}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </AgentLinkProvider>
  );
}
