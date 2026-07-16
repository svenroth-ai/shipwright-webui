/*
 * MissionRecordView — A11's interim Mission composer (FR-01.55).
 *
 * Owns the Record's shared `{activeNode, collapsed}` state and the join to A02's
 * per-run facts, and lays out the .mc-body: the Record rail + (when a node is
 * active) the artifact card. Keeping this OUT of TaskDetailPage keeps that page
 * genuinely "wire-only" (it is grandfathered at its LOC ceiling).
 *
 * This is the stepping-stone A13's MissionBody supersedes — A13 lifts the same
 * controlled RecordRail + ArtifactPanel into the three-equal-height-card shell
 * (adding A12's Operation card in the middle). The state contract is identical,
 * so the swap is drop-in.
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

export function MissionRecordView({ task, onOpenDocument }: Props) {
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
    // Clicking a node while the rail is collapsed expands it first; clicking the
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
      <div className="mc-body">
        <RecordRail
          nodes={nodes}
          activeNodeKey={activeNode}
          collapsed={collapsed}
          onNodeClick={handleNodeClick}
          onToggleCollapse={handleToggleCollapse}
        />
        {/* A12's Operation card — the flexible middle of .mc-body (verdict +
            mission line + curated proof summary). Consumes the SAME useMissionState
            + useRunDetail derivation as the Record, so the two can never disagree.
            A13 lifts this trio into the three-equal-card shell. */}
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
