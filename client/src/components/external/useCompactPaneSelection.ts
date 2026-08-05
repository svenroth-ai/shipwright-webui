import { useState } from "react";

import type { PaneId } from "./PaneTabBar";

type CenterTab = "transcript" | "terminal";

interface Options {
  activePane?: PaneId;
  centerTab?: CenterTab;
  onActivePaneChange?: (pane: PaneId) => void;
  onCenterTabChange?: (tab: CenterTab) => void;
}

export function useCompactPaneSelection(options: Options) {
  const [fallbackPane, setFallbackPane] = useState<PaneId>("center");
  const [fallbackCenterTab, setFallbackCenterTab] = useState<CenterTab>("terminal");
  const selectPane = (pane: PaneId) => {
    if (options.activePane === undefined) setFallbackPane(pane);
    options.onActivePaneChange?.(pane);
  };
  const selectCenterTab = (tab: CenterTab) => {
    if (options.centerTab === undefined) setFallbackCenterTab(tab);
    options.onCenterTabChange?.(tab);
  };
  return {
    resolvedPane: options.activePane ?? fallbackPane,
    resolvedCenterTab: options.centerTab ?? fallbackCenterTab,
    selectPane,
    selectCenterTab,
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
