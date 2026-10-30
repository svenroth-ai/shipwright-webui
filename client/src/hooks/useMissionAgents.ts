/*
 * useMissionAgents - state behind the Mission "Agents" bar + window (M4).
 * Data is the M3 session-info query (same cache key as the info sidebar; NO
 * timer - fetch on Mission entry / focus / task-state change / manual refresh).
 * `openFor` is how a chat subrunner card reaches the SAME agent detail view the
 * tree opens: it returns false when the card's agent is not (yet) in the
 * session-info list, so the caller can fall back to the legacy report panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActivityCard } from "../lib/missionActivityFeed";
import type { SessionSubagent } from "../lib/sessionInfoApi";
import { findAgentForCard, isActiveAgent } from "../lib/agentsTree";
import { useSessionInfo } from "./useSessionInfo";

const NONE: readonly SessionSubagent[] = [];
/** Feed growth rescans at most this often. */
const ACTIVITY_RESCAN_MS = 10_000;

export interface MissionAgents {
  agents: readonly SessionSubagent[];
  runningCount: number;
  open: boolean;
  selectedId: string | null;
  loading: boolean;
  failed: boolean;
  setOpen: (open: boolean) => void;
  select: (agentId: string) => void;
  /** Opens the window (optionally on a card's agent). False = that agent is unknown to session-info. */
  openFor: (subrunnerId?: string) => boolean;
  /** True when a card's agent can be opened in the window. */
  canOpen: (subrunnerId?: string) => boolean;
  /** The report the parent received for this agent (its resolved chat card's task-notification), or null. */
  reportFor: (agentId: string) => string | null;
  refresh: () => void;
  /** The element focused when the window opened (chip or chat card button); focus returns there on close. */
  returnFocusRef: { current: HTMLElement | null };
}

/** One entry per subrunner card (id:status): changes exactly when an agent was dispatched or resolved. */
const cardSignature = (cards: readonly ActivityCard[] | undefined) =>
  (cards ?? []).filter((c) => c.kind === "subrunner").map((c) => `${c.subrunnerId}:${c.subrunnerStatus}`).join("|");

export function useMissionAgents(
  taskId: string | null | undefined,
  taskState: string | null | undefined,
  cards?: readonly ActivityCard[],
): MissionAgents {
  const q = useSessionInfo(taskId, taskState);
  const agents = useMemo(() => (q.data?.status === "ok" ? q.data.info.subagents : NONE), [q.data]);
  const [open, setOpenState] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { refetch } = q;
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // The transcript is already polled for the feed: a dispatch / completion seen THERE is the
  // event-driven signal to rescan (one scan per event, no timer), so the bar cannot go stale.
  // Nested agents (a reviewer started by a runner) leave no card in the MAIN feed, so any feed growth
  // also triggers a rescan, throttled; the scan is memoised per changed file, so it stays cheap.
  const signature = cardSignature(cards);
  const activity = cards?.length ?? 0;
  const lastSignature = useRef(signature);
  const lastActivity = useRef(activity);
  const updatedAt = useRef(0);
  const lastFired = useRef(0);
  useEffect(() => {
    updatedAt.current = q.dataUpdatedAt;
  }, [q.dataUpdatedAt]);
  useEffect(() => {
    if (!taskId) return;
    const dispatched = lastSignature.current !== signature;
    const since = Date.now() - Math.max(updatedAt.current, lastFired.current); // last ATTEMPT too: errors cannot bypass it
    const grew = lastActivity.current !== activity && since > ACTIVITY_RESCAN_MS;
    lastSignature.current = signature;
    // A growth swallowed by the throttle is NOT consumed: the next growth still rescans.
    if (dispatched || grew) {
      lastActivity.current = activity;
      lastFired.current = Date.now();
      // A dispatch/completion must be seen by a scan that STARTS after it: restart one already in flight.
      void refetch({ cancelRefetch: dispatched });
    }
  }, [taskId, signature, activity, refetch]);

  const refresh = useCallback(() => void refetch({ cancelRefetch: false }), [refetch]);
  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !open) returnFocusRef.current = document.activeElement as HTMLElement | null;
      setOpenState(next);
      if (next) refresh(); // user-initiated: the list may have moved since Mission entry
    },
    [refresh, open],
  );
  const canOpen = useCallback((id?: string) => findAgentForCard(agents, id) !== null, [agents]);
  // The legacy SubrunnerPanel was the only place a card's notification report (e.g. a killed agent's
  // failure reason) was shown; the agent detail now shows it, so opening a card here loses nothing.
  const reportFor = useCallback(
    (agentId: string) => {
      const card = (cards ?? []).find(
        (c) => c.kind === "subrunner" && c.subrunnerStatus !== "running" && findAgentForCard(agents, c.subrunnerId)?.agentId === agentId,
      );
      return card?.subrunnerReportFull ?? card?.subrunnerReport ?? null;
    },
    [agents, cards],
  );
  const openFor = useCallback(
    (id?: string) => {
      if (id === undefined) {
        setSelectedId(null); // opened from the bar: land on the first agent, not a stale card pick
        setOpen(true);
        return true;
      }
      const a = findAgentForCard(agents, id);
      if (!a) {
        void refetch({ cancelRefetch: true }); // not known yet: rescan (fresh) so the next click can open it
        return false;
      }
      setSelectedId(a.agentId);
      setOpen(true);
      return true;
    },
    [agents, setOpen, refetch],
  );

  return {
    agents,
    runningCount: agents.filter(isActiveAgent).length,
    open,
    selectedId,
    loading: q.isLoading,
    failed: q.isError,
    setOpen,
    select: setSelectedId,
    openFor,
    canOpen,
    reportFor,
    refresh,
    returnFocusRef,
  };
}
