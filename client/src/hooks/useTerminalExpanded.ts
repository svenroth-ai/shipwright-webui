import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Compact (tablet/phone) "expand terminal" toggle. State is transient; it is
 * mirrored to `<html data-term-expanded>` so `styles/keyboard-fit.css` can fold
 * away the page chrome (tab row, status row) without prop plumbing. Two
 * controls drive it (the task-detail header and the Files & Terminal tab bar),
 * so the state is one module-level store. The flag is cleared when the last
 * consumer unmounts, so a user is never stuck expanded on the next route.
 */
let expanded = false;
let consumers = 0;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  expanded = next;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (next) root.setAttribute("data-term-expanded", "");
    else root.removeAttribute("data-term-expanded");
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTerminalExpanded(): [boolean, () => void] {
  const value = useSyncExternalStore(subscribe, () => expanded, () => false);
  useEffect(() => {
    consumers += 1;
    return () => {
      consumers -= 1;
      if (consumers === 0 && expanded) set(false);
    };
  }, []);
  const toggle = useCallback(() => set(!expanded), []);
  return [value, toggle];
}
