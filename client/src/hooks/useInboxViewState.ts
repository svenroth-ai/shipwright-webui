/*
 * useInboxViewState.ts — owns the Inbox page's remembered view: which project
 * groups are folded and the user's own project order
 * (iterate-2026-11-13-inbox-triage-look). Mirrors useTriageViewState: state
 * starts from a lazy read — never an effect — and only writes after a change,
 * so a first render can never overwrite the saved view with defaults. Purely a
 * view concern: no store write, no network.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadInboxView,
  saveInboxView,
  type InboxViewSnapshot,
} from "../lib/inboxViewStorage";

export interface InboxViewState {
  /** Project ids whose group is folded. */
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (projectId: string) => void;
  /** The user's own project order (project ids); empty = natural order. */
  projectOrder: readonly string[];
  setProjectOrder: (order: string[]) => void;
}

export function useInboxViewState(): InboxViewState {
  const [view, setView] = useState<InboxViewSnapshot>(loadInboxView);

  // Persist after every change, but never before the first one: the initial
  // state IS what was just read.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveInboxView(view);
  }, [view]);

  const toggleCollapsed = useCallback((projectId: string) => {
    setView((prev) => ({
      ...prev,
      collapsed: prev.collapsed.includes(projectId)
        ? prev.collapsed.filter((id) => id !== projectId)
        : [...prev.collapsed, projectId],
    }));
  }, []);

  const setProjectOrder = useCallback((order: string[]) => {
    setView((prev) => ({ ...prev, projectOrder: order }));
  }, []);

  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);

  return useMemo(
    () => ({ collapsed, toggleCollapsed, projectOrder: view.projectOrder, setProjectOrder }),
    [collapsed, toggleCollapsed, view.projectOrder, setProjectOrder],
  );
}
