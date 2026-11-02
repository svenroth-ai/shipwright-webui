/*
 * useSidebarViewerTabs - the info sidebar Viewer's open tabs (files AND Mission document tabs) and the
 * one in front. Extracted from MissionInfoSidebar. The synchronous ref mirror means two updates in one
 * tick (rapid close / open) never act on a stale list.
 */

import { useRef, useState } from "react";

import type { ViewerTarget } from "../lib/viewerTarget";

export function useSidebarViewerTabs() {
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const [tabs, setTabs] = useState<ViewerTarget[]>([]);
  const tabsRef = useRef<ViewerTarget[]>([]);
  const commit = (next: ViewerTarget[]) => {
    tabsRef.current = next;
    setTabs(next);
  };
  // A re-open replaces the stored target (latest line / refreshed title) and keeps the tab position.
  const addTab = (t: ViewerTarget) => {
    const prev = tabsRef.current;
    commit(prev.some((x) => x.path === t.path) ? prev.map((x) => (x.path === t.path ? t : x)) : [...prev, t]);
  };
  const closeTab = (path: string) => {
    const rest = tabsRef.current.filter((x) => x.path !== path);
    commit(rest);
    setTarget((cur) => (cur?.path === path ? (rest[rest.length - 1] ?? null) : cur));
  };
  const open = (t: ViewerTarget) => {
    setTarget(t);
    addTab(t);
  };
  return { target, setTarget, tabs, addTab, closeTab, open };
}
