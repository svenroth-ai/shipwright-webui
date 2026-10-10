import { useCallback, useEffect, useState } from "react";

/**
 * Compact (tablet/phone) "expand terminal" toggle. State is transient and local
 * to the task-detail header; it is mirrored to `<html data-term-expanded>` so
 * `styles/keyboard-fit.css` can fold away the page chrome (tab row, status row,
 * pane tabs) without prop plumbing. The flag is always cleared on unmount, so a
 * user is never stuck expanded on the next route.
 */
export function useTerminalExpanded(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (expanded) root.setAttribute("data-term-expanded", "");
    else root.removeAttribute("data-term-expanded");
    return () => root.removeAttribute("data-term-expanded");
  }, [expanded]);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  return [expanded, toggle];
}
