/*
 * TerminalExpandButton — the phone/tablet "Expand" control at the end of the
 * single Files · Terminal · Info · Viewer tab bar (mission-desktop-style-v2 V8).
 * Same state as the header toggle (useTerminalExpanded): it folds the page
 * chrome above the tab bar away; the tab bar itself stays, so it can be undone.
 */
import { Maximize2, Minimize2 } from "lucide-react";

import { useTerminalExpanded } from "../../hooks/useTerminalExpanded";

export function TerminalExpandButton() {
  const [expanded, toggle] = useTerminalExpanded();
  const label = expanded ? "Restore page layout" : "Expand terminal";
  return (
    <button
      type="button"
      className="ft-maximize"
      onClick={toggle}
      aria-pressed={expanded}
      aria-label={label}
      title={label}
      data-testid="pane-tab-expand"
    >
      {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
    </button>
  );
}
