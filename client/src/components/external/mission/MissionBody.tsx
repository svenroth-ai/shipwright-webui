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

import { useCallback, useMemo, useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useMissionLive } from "../../../hooks/useMissionLive";
import { useMissionContext } from "../../../hooks/useMissionContext";
import {
  isSupportedSchema,
  pipelinePhase,
  stageScenario,
  usesContextRail,
  visibleArtifacts,
} from "../../../lib/missionArtifacts";
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

/** The legacy `RecordNode` rail always renders these five; the context rail
 *  reports its own subset. Same key names, so an inline link resolves against
 *  whichever rail is mounted (FR-01.68 AC5). */
const LEGACY_RAIL_KEYS = ["req", "spec", "tests", "review", "commit"] as const;

export function MissionBody({ task, transcriptContent, onOpenDocument }: Props) {
  const [activeNode, setActiveNode] = useState<string | null>(null);

  // S1 — the context-resolved artifact rail. Additive: it engages ONLY for a
  // resolved standalone iterate on a schema this build understands. Every other
  // scenario (and any resolver failure) falls through to the legacy rail below,
  // so the Mission tab can never end up worse than it was.
  const contextQuery = useMissionContext(task?.taskId);
  const context = isSupportedSchema(contextQuery.data) ? contextQuery.data : null;
  const artifacts = usesContextRail(context) ? visibleArtifacts(context) : null;
  // While the run is IN FLIGHT its not-yet-written artifacts are listed as
  // pending instead of hidden, so the rail is not blank for the whole early
  // phase of every run (the operator is watching precisely then).
  const runLive = context?.runLive === true;

  // S4 — the SAME resolved context gates the stage derivation, so the
  // iterate-only sticky-Analyze rule never runs on a card with no iterate
  // lifecycle. Deliberately read from `context` and NOT from `artifacts`: a
  // `plain` scenario drives no rail but still must gate the stage (AC5).
  // FR-01.68 AC5: the narrative may only link to nodes the rail actually
  // offers, so the same list that renders the LEFT links gates the inline ones.
  // One selection model, no dead buttons. Both rails use the same key names
  // (`spec` / `tests` / `commit`), so a link resolves identically either way.
  const artifactKeys = useMemo(
    () => (artifacts ? artifacts.map((a) => a.kind) : LEGACY_RAIL_KEYS),
    [artifacts],
  );

  const model = useMissionLive(task, transcriptContent, {
    scenario: stageScenario(context),
    phase: pipelinePhase(context),
    artifactKeys,
  });
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

  // A DESIGN GATE keeps the A12 Operation card outright — it is a decision
  // surface, not a story.
  //
  // A COMPLETED run keeps its verdict + proof AND gains the narrative below it
  // (FR-01.68 AC10): a run should read the same before and after it finishes,
  // only more complete. The transcript is still on disk and `useTaskTranscript`
  // is ungated, so both states drive the SAME derivation and cannot diverge.
  const isDesignGate = model.missionState === "designgate";
  const completed = model.mode === "completed";

  return (
    <div className="min-h-0 flex-1" data-testid="task-detail-mission">
      <div className="mc-body" data-testid="mission-body">
        <MissionLeftPanel
          model={model}
          activeNodeKey={activeNode}
          onNodeClick={handleNodeClick}
          artifacts={artifacts}
          runLive={runLive}
        />
        {isDesignGate ? (
          <OperationCard task={task} />
        ) : completed ? (
          <div className="mc-op-stack" data-testid="mission-completed-stack">
            <OperationCard task={task} />
            <OperationLive paragraphs={model.narrative} onArtifactClick={handleNodeClick} />
          </div>
        ) : (
          <OperationLive paragraphs={model.narrative} onArtifactClick={handleNodeClick} />
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
