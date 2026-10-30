/*
 * useMissionSidebar — remembered layout of the Mission right sidebar (M3):
 * width (resizable), collapsed flag, active segment. Per-browser localStorage,
 * Smart Viewer pattern. Every read is defensive (storage may be absent/corrupt).
 */

import { useCallback, useState } from "react";

export type MissionSidebarSegment = "info" | "folders" | "viewer";

export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 560;
export const SIDEBAR_DEFAULT = 320;
const KEY = "shipwright:mission-sidebar";

interface Stored {
  width: number;
  collapsed: boolean;
  segment: MissionSidebarSegment;
}

export function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
}

function read(): Stored {
  const fallback: Stored = { width: SIDEBAR_DEFAULT, collapsed: false, segment: "info" };
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Stored>;
    return {
      width: typeof p.width === "number" ? clampSidebarWidth(p.width) : fallback.width,
      collapsed: p.collapsed === true,
      segment: p.segment === "folders" || p.segment === "viewer" ? p.segment : "info",
    };
  } catch {
    return fallback;
  }
}

export function useMissionSidebar() {
  const [state, setState] = useState<Stored>(read);

  const update = useCallback((patch: Partial<Stored>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* quota / disabled — layout simply is not remembered */
      }
      return next;
    });
  }, []);

  return {
    ...state,
    setWidth: (w: number) => update({ width: clampSidebarWidth(w) }),
    setCollapsed: (collapsed: boolean) => update({ collapsed }),
    setSegment: (segment: MissionSidebarSegment) => update({ segment }),
  };
}
