/* Resizable three-pane layout shell. Compact mode keeps every pane mounted and
 * exposes the four direct work surfaces through PaneTabBar. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";

import {
  useThreePaneLayout,
  LEFT_MIN,
  LEFT_MAX,
  RIGHT_MIN,
  RIGHT_MAX,
  COLLAPSED_LEFT_PX,
  STEP_PX,
} from "../../hooks/useThreePaneLayout";
import { useIsCompactViewport } from "../../hooks/useIsCompactViewport";
import { PaneTabBar, type PaneId } from "./PaneTabBar";
import { PaneSplitter } from "./PaneSplitter";
import { FocusModeContext } from "./focus-mode-context";
import {
  compactPaneA11y,
  useCompactPaneSelection,
} from "./useCompactPaneSelection";

interface Props {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  /** Container px width; tests pass a deterministic value. */
  containerWidth?: number;
  centerTab?: "transcript" | "terminal";
  activePane?: PaneId;
  onCenterTabChange?: (tab: "transcript" | "terminal") => void;
  onActivePaneChange?: (pane: PaneId) => void;
}

export function TaskDetailThreePane({
  left,
  center,
  right,
  containerWidth,
  centerTab,
  activePane,
  onCenterTabChange,
  onActivePaneChange,
}: Props) {
  const layout = useThreePaneLayout();
  const compact = useIsCompactViewport();
  const { resolvedPane, resolvedCenterTab, selectPane, selectCenterTab } =
    useCompactPaneSelection({
      activePane, centerTab, onActivePaneChange, onCenterTabChange,
    });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(
    containerWidth ?? 1280,
  );

  useEffect(() => {
    if (containerWidth !== undefined) {
      setMeasuredWidth(containerWidth);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const readWidth = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setMeasuredWidth(w);
    };
    readWidth();
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(readWidth)
      : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
    };
  }, [containerWidth]);

  // Translate px layout to panel percentages; focus mode hides both sides at 0.
  const total = Math.max(measuredWidth, 600);
  const maxed = layout.maximized;
  const effLeftCollapsed = maxed || layout.leftCollapsed;
  const effRightCollapsed = maxed || layout.rightCollapsed;
  const leftPx = maxed
    ? 0
    : layout.leftCollapsed
      ? COLLAPSED_LEFT_PX
      : layout.leftWidth;
  const rightPx = effRightCollapsed ? 0 : layout.rightWidth;
  const leftPct = maxed ? 0 : clampPct((leftPx / total) * 100, 3, 50);
  const rightPct = clampPct((rightPx / total) * 100, 0, 50);
  const centerPct = Math.max(10, 100 - leftPct - rightPct);

  // Compact keeps the SAME PanelGroup mounted; inactive panes resize to 0%.
  const sizes = compact
    ? {
        left: resolvedPane === "left" ? 100 : 0,
        center: resolvedPane === "center" ? 100 : 0,
        right: resolvedPane === "right" ? 100 : 0,
      }
    : { left: leftPct, center: centerPct, right: rightPct };

  const leftRef = useRef<ImperativePanelHandle | null>(null);
  const centerRef = useRef<ImperativePanelHandle | null>(null);
  const rightRef = useRef<ImperativePanelHandle | null>(null);

  // The library does not sync external size changes; its registry warms after commit.
  useEffect(() => {
    if (compact) return; // compact sizing is owned by the tab effect below
    try {
      leftRef.current?.resize(leftPct);
    } catch {
      /* registry not ready yet — next effect cycle will resolve it. */
    }
    try {
      rightRef.current?.resize(rightPct);
    } catch {
      /* registry not ready yet */
    }
  }, [compact, leftPct, rightPct]);

  // Resize rather than unmount so the embedded terminal survives.
  useEffect(() => {
    if (!compact) return;
    try {
      leftRef.current?.resize(sizes.left);
    } catch {
      /* registry not ready yet */
    }
    try {
      centerRef.current?.resize(sizes.center);
    } catch {
      /* registry not ready yet */
    }
    try {
      rightRef.current?.resize(sizes.right);
    } catch {
      /* registry not ready yet */
    }
  }, [compact, sizes.left, sizes.center, sizes.right]);

  const handleLeftDrag = (sizePct: number) => {
    // Compact and maximize are transient; never persist their widths.
    if (compact || layout.leftCollapsed || maxed) return;
    layout.setLeftWidth((sizePct / 100) * total);
  };
  const handleRightDrag = (sizePct: number) => {
    if (compact || layout.rightCollapsed || maxed) return;
    layout.setRightWidth((sizePct / 100) * total);
  };

  const leftSplitterKeydown = useMemo(
    () =>
      (e: React.KeyboardEvent) => {
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
      (e: React.KeyboardEvent) => {
        if (layout.maximized) return; // see leftSplitterKeydown
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
    [layout],
  );

  // Bridge maximize to the middle head's control (rendered here as a descendant).
  const focus = useMemo(
    () => ({ maximized: maxed, toggle: layout.toggleMaximized }),
    [maxed, layout.toggleMaximized],
  );

  return (
    <FocusModeContext.Provider value={focus}>
    <div
      ref={containerRef}
      className={
        compact
          ? "flex h-full min-h-0 w-full flex-col"
          : "flex h-full min-h-0 w-full"
      }
      data-testid="three-pane-root"
      data-compact={compact || undefined}
      data-maximized={maxed || undefined}
    >
      {compact && (
        <PaneTabBar
          active={resolvedPane}
          centerTab={resolvedCenterTab}
          onChange={selectPane}
          onCenterTabChange={selectCenterTab}
        />
      )}
      <PanelGroup
        direction="horizontal"
        className={compact ? "min-h-0 w-full flex-1" : "h-full w-full"}
      >
        <Panel
          {...compactPaneA11y(compact, resolvedPane, "left", "workspace-tab-left")}
          ref={leftRef}
          defaultSize={sizes.left}
          minSize={compact || maxed ? 0 : 3}
          maxSize={compact ? 100 : 50}
          onResize={handleLeftDrag}
          data-testid="pane-left"
          data-collapsed={effLeftCollapsed || undefined}
          className="h-full min-h-0 overflow-hidden"
        >
          {left}
        </Panel>
        <PaneSplitter
          hidden={compact || maxed}
          testId="splitter-left"
          ariaValueMin={LEFT_MIN}
          ariaValueMax={LEFT_MAX}
          ariaValueNow={layout.leftWidth}
          ariaLabel="Resize folder tree pane"
          onKeyDown={leftSplitterKeydown}
        />
        <Panel
          {...compactPaneA11y(compact, resolvedPane, "center", `workspace-tab-${resolvedCenterTab}`)}
          ref={centerRef}
          defaultSize={sizes.center}
          minSize={compact ? 0 : 20}
          data-testid="pane-center"
          className="h-full min-h-0 overflow-hidden"
        >
          {center}
        </Panel>
        <PaneSplitter
          hidden={compact || maxed}
          testId="splitter-right"
          ariaValueMin={RIGHT_MIN}
          ariaValueMax={RIGHT_MAX}
          ariaValueNow={layout.rightWidth}
          ariaLabel="Resize smart viewer pane"
          onKeyDown={rightSplitterKeydown}
        />
        <Panel
          {...compactPaneA11y(compact, resolvedPane, "right", "workspace-tab-right")}
          ref={rightRef}
          defaultSize={sizes.right}
          minSize={0}
          maxSize={compact ? 100 : 50}
          onResize={handleRightDrag}
          data-testid="pane-right"
          data-collapsed={effRightCollapsed || undefined}
          className="h-full min-h-0 overflow-hidden"
        >
          {right}
        </Panel>
      </PanelGroup>
    </div>
    </FocusModeContext.Provider>
  );
}

function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
