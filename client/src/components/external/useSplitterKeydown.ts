/* Keyboard handlers for the three-pane splitters. Extracted from
 * TaskDetailThreePane.tsx (bloat H1, iterate-2026-10-09) — behavior unchanged. */
import { useMemo } from "react";
import type { KeyboardEvent } from "react";

import { STEP_PX, type useThreePaneLayout } from "../../hooks/useThreePaneLayout";

interface Args {
  layout: ReturnType<typeof useThreePaneLayout>;
  tablet: boolean;
  /** Tablet viewer is transient local state — never the persisted prefs. */
  toggleTabletViewer: () => void;
}

export function useSplitterKeydown({ layout, tablet, toggleTabletViewer }: Args) {
  const leftSplitterKeydown = useMemo(
    () =>
      (e: KeyboardEvent) => {
        // Focus mode owns the widths transiently — never mutate/persist them.
        if (layout.maximized) return;
        if (layout.leftCollapsed) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            layout.toggleLeftCollapsed();
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          layout.nudgeLeft(-STEP_PX);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          layout.nudgeLeft(STEP_PX);
        } else if (e.key === "Enter") {
          e.preventDefault();
          layout.toggleLeftCollapsed();
        }
      },
    [layout],
  );

  const rightSplitterKeydown = useMemo(
    () =>
      (e: KeyboardEvent) => {
        if (layout.maximized) return; // see leftSplitterKeydown
        if (tablet) {
          if (e.key === "Enter") {
            e.preventDefault();
            toggleTabletViewer();
          }
          return;
        }
        if (layout.rightCollapsed) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            layout.toggleRightCollapsed();
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          layout.nudgeRight(STEP_PX);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          layout.nudgeRight(-STEP_PX);
        } else if (e.key === "Enter") {
          e.preventDefault();
          layout.toggleRightCollapsed();
        }
      },
    [layout, tablet, toggleTabletViewer],
  );

  return { leftSplitterKeydown, rightSplitterKeydown };
}
