/*
 * MissionBody — the `.mc-body` of Mission Control (A13, FR-01.57; redesigned by
 * FR-01.66 to be a LIVE view of the session from the JSONL).
 *
 * The three equal-height cards that FLOAT on the photo, with gaps and NO dark
 * scrim: the LEFT panel (FR-01.66 `MissionLeftPanel` — business summary · the
 * `Spec·Build·Test·Finalize` stage · artifact links; this REPLACES A11's Record
 * rail spine) · the MIDDLE card · the Artifact card (mounted ONLY when a link is
 * active). The cards are rounded glass; each scrolls internally and — being flex
 * children of a definite-height row — renders at IDENTICAL height.
 *
 * ONE derivation for the whole cluster: `useMissionLive` composes the transcript
 * summary (fed the SAME `useTaskTranscript` poll from TaskDetailPage — no second
 * poller), the run join and the Mission state. The MIDDLE is chosen from the
 * model: a `designgate` or a COMPLETED run keeps the A12 Operation card (verdict +
 * proof); a LIVE / ad-hoc / empty session shows the live JSONL narration
 * (`OperationLive`). Read-only observer throughout (rule 1 / DO-NOT #1).
 */

import { useCallback, useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useMissionLive } from "../../../hooks/useMissionLive";
import { useMissionContext } from "../../../hooks/useMissionContext";
import { isSupportedSchema, usesContextRail, visibleArtifacts } from "../../../lib/missionArtifacts";
import { MissionLeftPanel } from "./MissionLeftPanel";
import { OperationCard } from "./OperationCard";
import { OperationLive } from "./OperationLive";
import { ArtifactPanel } from "./ArtifactPanel";
import { MissionArtifactPanel } from "./MissionArtifactPanel";

interface Props {
  task: ExternalTask;
  /** Raw JSONL from TaskDetailPage's single `useTaskTranscript` poll (rule 4 /
   *  DO-NOT #1). Passed IN so the Mission tab opens NO second poller. */
  transcriptContent: string;
  /** "Open full document" routes to the existing Files & Terminal / SmartViewer
   *  surface (no second viewer). */
  onOpenDocument: () => void;
}

export function MissionBody({ task, transcriptContent, onOpenDocument }: Props) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const model = useMissionLive(task, transcriptContent);

  // S1 — the context-resolved artifact rail. Additive: it engages ONLY for a
  // resolved standalone iterate on a schema this build understands. Every other
  // scenario (and any resolver failure) falls through to the legacy rail below,
  // so the Mission tab can never end up worse than it was.
  const contextQuery = useMissionContext(task?.taskId);
  const context = isSupportedSchema(contextQuery.data) ? contextQuery.data : null;
  const artifacts = usesContextRail(context) ? visibleArtifacts(context) : null;
  const activeArtifact = artifacts?.find((a) => a.kind === activeNode) ?? null;

  const activeRecordNode =
    activeNode && !artifacts
      ? model.nodes.find((n) => n.key === activeNode) ?? null
      : null;

  const handleNodeClick = useCallback((key: string) => {
    // Clicking the already-active link closes the artifact (prototype window.__node).
    setActiveNode((curr) => (curr === key ? null : key));
  }, []);
  const handleClose = useCallback(() => setActiveNode(null), []);
  const handleOpenDocument = useCallback(() => {
    setActiveNode(null);
    onOpenDocument();
  }, [onOpenDocument]);

  // The A12 Operation card (verdict + proof) stays for a design gate and for a
  // COMPLETED run (AC2 — completed runs keep their proof). A LIVE / ad-hoc / empty
  // session shows the live JSONL narration instead of "No run data yet" (AC1/AC3).
  const showOperationCard = model.missionState === "designgate" || model.mode === "completed";

  return (
    <div className="min-h-0 flex-1" data-testid="task-detail-mission">
      <div className="mc-body" data-testid="mission-body">
        <MissionLeftPanel
          model={model}
          activeNodeKey={activeNode}
          onNodeClick={handleNodeClick}
          artifacts={artifacts}
        />
        {showOperationCard ? (
          <OperationCard task={task} />
        ) : (
          <OperationLive narration={model.narration} />
        )}
        {activeArtifact ? (
          <MissionArtifactPanel
            taskId={task.taskId}
            artifact={activeArtifact}
            onClose={handleClose}
          />
        ) : activeRecordNode ? (
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
