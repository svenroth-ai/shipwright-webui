/*
 * AgentsDock - hosts the modal Agents window (M4) for ONE useMissionAgents controller. The
 * "<n> agents running" pill that opens it lives in the Info sidebar (AgentsPill); the window
 * also opens from a chat subrunner card, via useMissionAgents. Mounted by MissionBody (Mission
 * tab) and by the Files & Terminal right card, each with its own controller.
 * Read-only observer (DO-NOT #1): no composer, no chat-* surface (spec 35).
 */

import { useEffect, useRef } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionAgents } from "../../../hooks/useMissionAgents";
import { AgentsWindow } from "./AgentsWindow";

export function AgentsDock({ task, controller }: { task: ExternalTask; controller: MissionAgents }) {
  // If the host unmounts (tab switch, design gate), close the window instead of leaving open=true.
  const setOpenRef = useRef(controller.setOpen);
  useEffect(() => {
    setOpenRef.current = controller.setOpen;
  }, [controller.setOpen]);
  useEffect(() => () => setOpenRef.current(false), []);
  return <AgentsWindow task={task} controller={controller} />;
}
