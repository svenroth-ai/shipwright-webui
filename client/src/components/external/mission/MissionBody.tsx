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
 * poller), the run join and the Mission state. The MIDDLE is the A12 Operation
 * card ONLY for a `designgate` (a decision surface, not a story) — every other
 * state (live or completed) shows the activity feed directly, with no separate
 * verdict/proof header above it (Sven: the run-id/"suite green" strip above the
 * feed read as redundant clutter, iterate-2026-09-16-mission-feed-render-
 * fidelity — removed rather than conditionally hidden, since a genuinely red
 * gate already surfaces through the feed's own blocker/test cards). Read-only
 * observer throughout (rule 1 / DO-NOT #1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { CommitArtifact } from "../../../lib/missionContextApi";
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
import { MissionActivityFeed } from "./MissionActivityFeed";
import { ArtifactPanel } from "./ArtifactPanel";
import { MissionArtifactPanel } from "./MissionArtifactPanel";
import { SubrunnerPanel } from "./SubrunnerPanel";
import { useIsCompactViewport } from "../../../hooks/useIsCompactViewport";
import {
  MissionCompactTabs,
  type MissionCompactPanel,
} from "./MissionCompactTabs";

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
  const compact = useIsCompactViewport();
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [compactPanel, setCompactPanel] = useState<MissionCompactPanel>("overview");
  const detailReturnPanelRef = useRef<"overview" | "activity">("overview");
  const overviewTabRef = useRef<HTMLButtonElement | null>(null);
  const activityTabRef = useRef<HTMLButtonElement | null>(null);
  const detailTabRef = useRef<HTMLButtonElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

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
    runId: context?.scenario === "iterate" ? context.runId : undefined,
    context,
  });
  // A work-completed run can truthfully be terminal before its commit/PR has
  // been recorded. The final feed card still opens that delivery detail (which
  // explains the missing receipt) even though hide-empty omits it from the rail.
  const commitArtifact = (context?.artifacts.find((a) => a.kind === "commit") as CommitArtifact | undefined) ?? null;
  const activeArtifact = artifacts?.find((a) => a.kind === activeNode)
    ?? (activeNode === "commit" ? commitArtifact : null);

  const activeRecordNode =
    activeNode && !artifacts
      ? model.nodes.find((n) => n.key === activeNode) ?? null
      : null;
  // A resolved subrunner card's right-panel key is `subrunner:<id>`
  // (iterate-2026-09-26-mission-tab-subrunner) — namespaced so it can never
  // collide with a plain artifact/record-node key. Third consumer of this
  // same `activeNode` mechanic, additive alongside `ArtifactPanel`/
  // `MissionArtifactPanel`.
  const activeSubrunnerCard = activeNode?.startsWith("subrunner:")
    ? model.feed.cards.find((c) => c.kind === "subrunner" && `subrunner:${c.subrunnerId}` === activeNode) ?? null
    : null;
  const detailAvailable = activeArtifact !== null || activeRecordNode !== null || activeSubrunnerCard !== null;

  const focusPanelTab = useCallback((panel: "overview" | "activity") => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      (panel === "overview" ? overviewTabRef : activityTabRef).current?.focus();
    });
  }, []);

  const closeDetail = useCallback(() => {
    setActiveNode(null);
    const target = detailReturnPanelRef.current;
    if (compactPanel === "detail") setCompactPanel(target);
    if (compact) {
      focusPanelTab(target);
    }
  }, [compact, compactPanel, focusPanelTab]);

  useEffect(() => {
    if (!activeNode || detailAvailable) return;
    setActiveNode(null);
    if (compactPanel === "detail") {
      const target = detailReturnPanelRef.current;
      setCompactPanel(target);
      if (compact) focusPanelTab(target);
    }
  }, [activeNode, compact, compactPanel, detailAvailable, focusPanelTab]);

  const handleNodeClick = useCallback((key: string) => {
    if (activeNode === key) {
      if (compact && (compactPanel === "overview" || compactPanel === "activity")) {
        detailReturnPanelRef.current = compactPanel;
      }
      closeDetail();
      return;
    }
    if (compact) {
      if (compactPanel === "overview" || compactPanel === "activity") {
        detailReturnPanelRef.current = compactPanel;
      }
      setCompactPanel("detail");
    }
    setActiveNode(key);
  }, [activeNode, closeDetail, compact, compactPanel]);
  const handleClose = closeDetail;
  const handleOpenDocument = useCallback(() => {
    closeDetail();
    onOpenDocument();
  }, [closeDetail, onOpenDocument]);

  const handlePanelChange = useCallback((panel: MissionCompactPanel) => {
    if (panel === "detail" && !detailAvailable) return;
    if (
      panel === "detail" &&
      (compactPanel === "overview" || compactPanel === "activity")
    ) {
      detailReturnPanelRef.current = compactPanel;
    }
    setCompactPanel(panel);
  }, [compactPanel, detailAvailable]);

  // A DESIGN GATE keeps the A12 Operation card outright — it is a decision
  // surface, not a story. Every other state (live or completed) shows the
  // activity feed directly — see this component's own doc comment for why
  // the completed-run verdict/proof header was removed rather than kept
  // conditionally. 69th (glm, low, regression), FLAGGED-not-fixed by glm's own
  // reading: a terminal iterate whose legacy run join has not caught up now
  // gets the feed where it used to get the resolved `OperationCard`, and the
  // `mission-completed-stack` testid is gone for any downstream consumer. Both
  // are exactly what requirement 1 asked for ("removed rather than
  // conditionally hidden"), and the reconciled gate summary card carries the
  // verdict the header used to. Pinned in `MissionBody.context.test.tsx`.
  // Re-raised 78-81 (glm, low), each time answering itself "spec-sanctioned
  // and pinned by tests; only relevant to an OUT-OF-REPO consumer". A repo-wide
  // search for the testid returns the two rewritten tests and nothing else.
  const isDesignGate = model.missionState === "designgate";

  return (
    // `flex flex-col` (not a bare block) is load-bearing: `.mc-body` is
    // `flex:1; min-height:0`, which is INERT unless its parent is a flex
    // container. Without it the three-card row grows to its tallest child's
    // content height and the whole cluster overflows the shell scroller
    // (`.scene-fore`) — so the PAGE scrolls instead of each card scrolling
    // internally (iterate-2026-07-23-mission-viewer-scroll-popout; broken
    // since the three-card shell #271).
    <div className="flex min-h-0 flex-1 flex-col" data-testid="task-detail-mission">
      {compact && (
        <MissionCompactTabs
          active={compactPanel}
          detailAvailable={detailAvailable}
          onChange={handlePanelChange}
          overviewRef={overviewTabRef}
          activityRef={activityTabRef}
          detailRef={detailTabRef}
        />
      )}
      <div className="mc-body" data-testid="mission-body">
        <div
          id="mission-panel-overview"
          role={compact ? "tabpanel" : undefined}
          aria-labelledby={compact ? "mission-compact-tab-overview" : undefined}
          className="mission-panel"
          hidden={compact && compactPanel !== "overview"}
          data-testid="mission-panel-overview"
        >
          <MissionLeftPanel
            model={model}
            activeNodeKey={activeNode}
            onNodeClick={handleNodeClick}
            artifacts={artifacts}
            runLive={runLive}
          />
        </div>
        <div
          id="mission-panel-activity"
          role={compact ? "tabpanel" : undefined}
          aria-labelledby={compact ? "mission-compact-tab-activity" : undefined}
          className="mission-panel"
          hidden={compact && compactPanel !== "activity"}
          data-testid="mission-panel-activity"
        >
          {/* 36th-round external review catch (glm, medium), DECLINED: a
              COMPLETED run with a missing/empty transcript does NOT render an
              empty panel here. `reconcileArtifactCards` synthesizes the
              recorded gate verdict + artifact cards from MissionContext when
              the transcript contributes none, so the verdict the removed
              `OperationCard` used to carry still reaches the user. Pinned by
              two tests in `MissionBody.context.test.tsx` that both pass
              `transcriptContent=""` for a terminal task. */}
          {isDesignGate ? (
            <OperationCard task={task} context={context} />
          ) : (
            <MissionActivityFeed feed={model.feed} onArtifactClick={handleNodeClick} onSubrunnerClick={(subrunnerId) => handleNodeClick(`subrunner:${subrunnerId}`)} commitArtifact={commitArtifact} task={task} visible={!compact || compactPanel === "activity"} />
          )}
        </div>
        <div
          id="mission-panel-detail"
          role={compact ? "tabpanel" : undefined}
          aria-labelledby={compact ? "mission-compact-tab-detail" : undefined}
          className="mission-panel"
          hidden={compact && compactPanel !== "detail"}
          data-testid="mission-panel-detail"
        >
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
          ) : activeSubrunnerCard ? (
            <SubrunnerPanel card={activeSubrunnerCard} onClose={handleClose} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
