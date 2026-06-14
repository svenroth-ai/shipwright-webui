/*
 * TaskDetailThreePane — react-resizable-panels wrapper (iterate 3
 * section 04).
 *
 * Folder tree | bubble transcript | smart viewer. Widths persist via
 * {@link useThreePaneLayout}; when a side pane is collapsed the layout
 * switches to a 48 px icon rail on the left / fully hidden on the right.
 * Splitter handles own keyboard accessibility (arrow keys: 10 px step;
 * Enter: collapse/expand).
 *
 * This is a pure layout shell — it renders whatever children the caller
 * passes into `left` / `center` / `right`. All data-fetching lives in
 * the slot components (`FolderTree`, `BubbleTranscript`, `SmartViewer`).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";

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

interface Props {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  /**
   * Container px width — used to translate min/max px into percentage
   * sizes that react-resizable-panels accepts. In tests we override with
   * a fixed value so sizing is deterministic.
   */
  containerWidth?: number;
}

export function TaskDetailThreePane({
  left,
  center,
  right,
  containerWidth,
}: Props) {
  const layout = useThreePaneLayout();
  const compact = useIsCompactViewport();
  const [activeTab, setActiveTab] = useState<PaneId>("center");
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

  // Translate px layout into % sizes for react-resizable-panels.
  const total = Math.max(measuredWidth, 600);
  const leftPx = layout.leftCollapsed ? COLLAPSED_LEFT_PX : layout.leftWidth;
  const rightPx = layout.rightCollapsed ? 0 : layout.rightWidth;
  const leftPct = clampPct((leftPx / total) * 100, 3, 50);
  const rightPct = clampPct((rightPx / total) * 100, 0, 50);
  const centerPct = Math.max(10, 100 - leftPct - rightPct);

  // Compact (≤1023px): one pane at a time via the tab bar; the SAME PanelGroup
  // stays mounted (inactive panes → 0%) so `center`'s terminal never unmounts.
  const sizes = compact
    ? {
        left: activeTab === "left" ? 100 : 0,
        center: activeTab === "center" ? 100 : 0,
        right: activeTab === "right" ? 100 : 0,
      }
    : { left: leftPct, center: centerPct, right: rightPct };

  const leftRef = useRef<ImperativePanelHandle | null>(null);
  const centerRef = useRef<ImperativePanelHandle | null>(null);
  const rightRef = useRef<ImperativePanelHandle | null>(null);

  // Keep the panels in sync when the hook's values change (e.g. keyboard
  // resize). react-resizable-panels doesn't auto-sync when controlled
  // externally, so we invoke the imperative handle. Swallow the first
  // call when the panel registry is still warming up (test-only edge
  // case: resize() throws "Panel size not found" until the group has
  // committed at least once).
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

  // Compact tab sizing: collapse inactive panes to 0% and grow the active one.
  // Resizing (not unmounting) keeps every pane's children alive; the embedded
  // terminal refits via its ResizeObserver when its pane grows from 0 → full.
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
    // compact tab-sizing must NOT persist (would clobber saved desktop widths).
    if (compact || layout.leftCollapsed) return;
    layout.setLeftWidth((sizePct / 100) * total);
  };
  const handleRightDrag = (sizePct: number) => {
    if (compact || layout.rightCollapsed) return;
    layout.setRightWidth((sizePct / 100) * total);
  };

  const leftSplitterKeydown = useMemo(
    () =>
      (e: React.KeyboardEvent) => {
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

  return (
    <div
      ref={containerRef}
      className={
        compact
          ? "flex h-full min-h-0 w-full flex-col"
          : "flex h-full min-h-0 w-full"
      }
      data-testid="three-pane-root"
      data-compact={compact || undefined}
    >
      {compact && <PaneTabBar active={activeTab} onChange={setActiveTab} />}
      <PanelGroup
        direction="horizontal"
        className={compact ? "min-h-0 w-full flex-1" : "h-full w-full"}
      >
        <Panel
          ref={leftRef}
          defaultSize={sizes.left}
          minSize={compact ? 0 : 3}
          maxSize={compact ? 100 : 50}
          onResize={handleLeftDrag}
          data-testid="pane-left"
          data-collapsed={layout.leftCollapsed || undefined}
          className="h-full min-h-0 overflow-hidden"
        >
          {left}
        </Panel>
        <PanelResizeHandle
          className={
            (compact ? "hidden " : "") +
            "group relative w-[5px] shrink-0 cursor-col-resize bg-transparent transition hover:bg-[var(--color-primary,#6b5e56)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#6b5e56)]"
          }
          data-testid="splitter-left"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={LEFT_MIN}
          aria-valuemax={LEFT_MAX}
          aria-valuenow={layout.leftWidth}
          aria-label="Resize folder tree pane"
          tabIndex={0}
          // react-resizable-panels' HTMLAttributes alias uses
          // `keyof HTMLElementTagNameMap` for the element generic, which
          // types onKeyDown as `KeyboardEventHandler<string>`. This is a
          // library typing quirk; our handler is structurally compatible
          // so we cast via `as any` locally (single-prop scope).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onKeyDown={leftSplitterKeydown as any}
        />
        <Panel
          ref={centerRef}
          defaultSize={sizes.center}
          minSize={compact ? 0 : 20}
          data-testid="pane-center"
          className="h-full min-h-0 overflow-hidden"
        >
          {center}
        </Panel>
        <PanelResizeHandle
          className={
            (compact ? "hidden " : "") +
            "group relative w-[5px] shrink-0 cursor-col-resize bg-transparent transition hover:bg-[var(--color-primary,#6b5e56)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#6b5e56)]"
          }
          data-testid="splitter-right"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={RIGHT_MIN}
          aria-valuemax={RIGHT_MAX}
          aria-valuenow={layout.rightWidth}
          aria-label="Resize smart viewer pane"
          tabIndex={0}
          // See note on the left splitter — identical library typing quirk.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onKeyDown={rightSplitterKeydown as any}
        />
        <Panel
          ref={rightRef}
          defaultSize={sizes.right}
          minSize={0}
          maxSize={compact ? 100 : 50}
          onResize={handleRightDrag}
          data-testid="pane-right"
          data-collapsed={layout.rightCollapsed || undefined}
          className="h-full min-h-0 overflow-hidden"
        >
          {right}
        </Panel>
      </PanelGroup>
    </div>
  );
}

function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
