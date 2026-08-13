import { useState } from "react";

import type { PaneId } from "./PaneTabBar";

interface Options {
  activePane?: PaneId;
  onActivePaneChange?: (pane: PaneId) => void;
}

export function useCompactPaneSelection(options: Options) {
  const [fallbackPane, setFallbackPane] = useState<PaneId>("center");
  const selectPane = (pane: PaneId) => {
    if (options.activePane === undefined) setFallbackPane(pane);
    options.onActivePaneChange?.(pane);
  };
  return {
    resolvedPane: options.activePane ?? fallbackPane,
    selectPane,
  };
}

export function compactPaneA11y(
  compact: boolean,
  active: PaneId,
  pane: PaneId,
  label: string,
) {
  const id = `task-pane-${pane}`;
  if (!compact) return { id };
  const inactive = active !== pane;
  if (pane === "center") {
    return { id, "aria-hidden": inactive || undefined,
      inert: inactive || undefined } as const;
  }
  return { id, role: "tabpanel", "aria-labelledby": label,
    "aria-hidden": inactive || undefined, inert: inactive || undefined } as const;
}
