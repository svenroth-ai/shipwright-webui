/*
 * RecordRail — "The Record" left card of Mission Control (FR-01.55, A11).
 *
 * ONE clickable spine that MERGES the process rail and the trace spine into a
 * single artifact: each node is a phase AND its receipt. This ABSORBS the former
 * A13 trace slot (FR→spec→tests→commit) — there is no separate such component,
 * route or export anywhere in client/src.
 *
 * Controlled + presentational: the `{activeNodeKey, collapsed}` state is owned
 * by the composer (TaskDetailPage today, A13's MissionBody later) so the same
 * rail composes into the three-card shell with the artifact as a SIBLING card.
 * Node state + wording are pre-derived (recordNodes.ts → A10's narrator).
 */

import { ChevronRight } from "lucide-react";

import type { RecordNodeView } from "../../../lib/recordNodes";
import { RecordNode } from "./RecordNode";

interface Props {
  nodes: RecordNodeView[];
  activeNodeKey: string | null;
  collapsed: boolean;
  onNodeClick: (key: string) => void;
  onToggleCollapse: () => void;
}

export function RecordRail({
  nodes,
  activeNodeKey,
  collapsed,
  onNodeClick,
  onToggleCollapse,
}: Props) {
  return (
    <nav
      className={`record${collapsed ? " collapsed" : ""}`}
      aria-label="The Record"
      data-testid="record-rail"
      data-collapsed={collapsed || undefined}
    >
      <div className="rec-spine" aria-hidden="true" />
      <div className="rec-h">
        <span className="eyebrow">The Record</span>
      </div>
      {nodes.map((node) => (
        <RecordNode
          key={node.key}
          node={node}
          active={activeNodeKey === node.key}
          collapsed={collapsed}
          onClick={() => onNodeClick(node.key)}
        />
      ))}
      <button
        type="button"
        className="rec-collapse"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the record" : "Hide the record"}
        data-testid="record-collapse"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          style={{ transform: collapsed ? "none" : "rotate(180deg)" }}
        />
        <span className="rc-label">Hide the record</span>
      </button>
    </nav>
  );
}
