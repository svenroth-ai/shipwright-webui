/*
 * MissionBody — the `.mc-body` of Mission Control (A13, FR-01.57).
 *
 * The three equal-height cards that FLOAT on the photo, with gaps and NO dark
 * scrim behind them (`.on-photo .a-scrim { display:none }`, A11): the Record rail
 * (A11, 248px / 60px collapsed) · the Operation card (A12, flex) · the Artifact
 * card (A11, 400px `position:static`, mounted ONLY when a node is active). The
 * cards are rounded glass with `--sh-photo`; each scrolls internally and — being
 * flex children of a definite-height row — they render at IDENTICAL height.
 *
 * This SUPERSEDES A11's interim `MissionRecordView`: same controlled
 * `{activeNode, collapsed}` contract, same `useMissionState` + `useRunDetail`
 * derivation (ONE derivation for the whole cluster — nothing re-derives). The
 * only overlay element in the subtree is the Artifact's own compact slide-over
 * scrim (`.a-scrim`, display:none on the photo); MissionBody adds no scrim,
 * dimming layer or `rgba()` panel behind the row.
 *
 * Render modes come from `useMissionState()` — NO user-facing state switcher is
 * shipped (the prototype's `stateToggle` was a demo affordance; AC5). The
 * `designgate` mode routes through the Operation card to A14's design-gate surface.
 */

import { useCallback, useMemo, useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useMissionState } from "../../../hooks/useMissionState";
import { useRunDetail } from "../../../hooks/useRunData";
import { deriveRecordNodes } from "../../../lib/recordNodes";
import { RecordRail } from "./RecordRail";
import { OperationCard } from "./OperationCard";
import { ArtifactPanel } from "./ArtifactPanel";

interface Props {
  task: ExternalTask;
  /** "Open full document" routes to the existing Files & Terminal / SmartViewer
   *  surface (no second viewer). */
  onOpenDocument: () => void;
}

export function MissionBody({ task, onOpenDocument }: Props) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const missionState = useMissionState(task);
  const runDetail = useRunDetail(task.projectId, task.runId ?? null);
  const facts = runDetail.data?.status === "ok" ? runDetail.data.run : null;
  const nodes = useMemo(
    () => deriveRecordNodes({ missionState, facts }),
    [missionState, facts],
  );
  const activeRecordNode = activeNode
    ? nodes.find((n) => n.key === activeNode) ?? null
    : null;

  const handleNodeClick = useCallback((key: string) => {
    // Clicking a node while collapsed expands the rail first; clicking the
    // already-active node closes the artifact (prototype window.__node).
    setCollapsed(false);
    setActiveNode((curr) => (curr === key ? null : key));
  }, []);
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      if (next) setActiveNode(null); // collapsing clears the active node
      return next;
    });
  }, []);
  const handleClose = useCallback(() => setActiveNode(null), []);
  const handleOpenDocument = useCallback(() => {
    setActiveNode(null);
    onOpenDocument();
  }, [onOpenDocument]);

  return (
    <div className="min-h-0 flex-1" data-testid="task-detail-mission">
      <div className="mc-body" data-testid="mission-body">
        <RecordRail
          nodes={nodes}
          activeNodeKey={activeNode}
          collapsed={collapsed}
          onNodeClick={handleNodeClick}
          onToggleCollapse={handleToggleCollapse}
        />
        {/* A12's Operation card — the flexible middle. `designgate` routes to A14's
            surface (an honest placeholder until A14 lands). Consumes the SAME
            useMissionState + useRunDetail derivation as the Record, so the two can
            never disagree. */}
        <OperationCard task={task} />
        {activeRecordNode ? (
          <ArtifactPanel
            node={activeRecordNode}
            onClose={handleClose}
            onOpenDocument={handleOpenDocument}
          />
        ) : null}
      </div>
    </div>
  );
}
