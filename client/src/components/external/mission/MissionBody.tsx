/*
 * MissionBody — the `.mc-body` of Mission Control (A13, FR-01.57; redesigned by
 * FR-01.66 to be a LIVE view of the session from the JSONL).
 *
 * The equal-height cards that FLOAT on the photo, with gaps and NO dark scrim:
 * the LEFT panel (FR-01.66 `MissionLeftPanel` — business summary · the
 * `Spec·Build·Test·Finalize` stage · artifact links) · the MIDDLE card · the
 * info SIDEBAR. The cards are rounded glass; each scrolls internally and — being
 * flex children of a definite-height row — renders at IDENTICAL height.
 *
 * ONE viewer surface (iterate-2026-11-02-mission-links-viewer-probe): every link
 * of the Mission tab — a left-rail artifact, a Run-result button, an inline
 * narrative link, a sub-agent row — opens as a TAB of the info sidebar's Viewer
 * (the same strip that holds opened files). There is no separate "detail" card,
 * so no empty middle panel is left behind; the phone has Overview | Activity |
 * Info tabs and a link jumps to Info (Viewer).
 *
 * ONE derivation for the whole cluster: `useMissionLive` composes the transcript
 * summary (fed the SAME `useTaskTranscript` poll from TaskDetailPage — no second
 * poller), the run join and the Mission state. The MIDDLE is the A12 Operation
 * card ONLY for a `designgate` (a decision surface, not a story) — every other
 * state (live or completed) shows the activity feed directly. Read-only
 * observer throughout (rule 1 / DO-NOT #1).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { FileOpenContext } from "../FileOpenContext";
import { useMissionFileOpen } from "../../../hooks/useMissionFileOpen";

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
import { MissionDetailView, detailLabel, resolveDetail } from "./MissionDetailView";
import { AgentsDock } from "./AgentsDock";
import { useMissionAgents } from "../../../hooks/useMissionAgents";
import { MissionInfoSidebar, type SidebarDocs } from "./MissionInfoSidebar";
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
  // The document tab in front in the Viewer (drives the rail highlight); the sidebar owns the tabs.
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [docRequest, setDocRequest] = useState<SidebarDocs["request"]>(null);
  const [compactPanel, setCompactPanel] = useState<MissionCompactPanel>("overview");
  const overviewTabRef = useRef<HTMLButtonElement | null>(null);
  const activityTabRef = useRef<HTMLButtonElement | null>(null);
  const infoTabRef = useRef<HTMLButtonElement | null>(null);

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
  const agents = useMissionAgents(task.taskId, task.state, model.feed.cards);
  // V6: a chat file chip opens the Viewer in the info sidebar (not behind the Agents window).
  const showViewer = useCallback(() => { setCompactPanel("info"); agents.setOpen(false); }, [agents.setOpen]);
  const { fileOpen, request: viewerRequest } = useMissionFileOpen(task, showViewer);
  // A work-completed run can truthfully be terminal before its commit/PR has
  // been recorded. The final feed card still opens that delivery detail (which
  // explains the missing receipt) even though hide-empty omits it from the rail.
  const commitArtifact = (context?.artifacts.find((a) => a.kind === "commit") as CommitArtifact | undefined) ?? null;

  const sources = { artifacts, commitArtifact, nodes: model.nodes, cards: model.feed.cards };
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Every Mission link funnels here: resolve it, then hand it to the sidebar as a Viewer tab.
  const openDoc = useCallback((key: string) => {
    const detail = resolveDetail(key, sourcesRef.current);
    if (!detail) return;
    setDocRequest((prev) => ({ key, label: detailLabel(detail), nonce: (prev?.nonce ?? 0) + 1 }));
    agents.setOpen(false);
    if (compact) setCompactPanel("info");
  }, [agents.setOpen, compact]);

  const docs = useMemo<SidebarDocs>(() => ({
    request: docRequest,
    onActiveChange: setActiveNode,
    render: (key, close) => {
      const detail = resolveDetail(key, sourcesRef.current);
      if (!detail) return null;
      const openFull = () => { close(); onOpenDocument(); };
      return <MissionDetailView detail={detail} taskId={task.taskId} cards={sourcesRef.current.cards} agents={agents} onClose={close} onOpenDocument={openFull} />;
    },
  }), [docRequest, onOpenDocument, task.taskId, agents]);

  // A DESIGN GATE keeps the A12 Operation card (a decision surface, not a
  // story); every other state shows the activity feed. The completed-run
  // verdict header and its `mission-completed-stack` testid were removed on
  // purpose (iterate-2026-09-16); pinned in `MissionBody.context.test.tsx`.
  const isDesignGate = model.missionState === "designgate";

  return (
    // `flex flex-col` (not a bare block) is load-bearing: `.mc-body` is
    // `flex:1; min-height:0`, which is INERT unless its parent is a flex
    // container. Without it the card row grows to its tallest child's
    // content height and the whole cluster overflows the shell scroller
    // (`.scene-fore`) — so the PAGE scrolls instead of each card scrolling
    // internally (iterate-2026-07-23-mission-viewer-scroll-popout; broken
    // since the three-card shell #271).
    <FileOpenContext.Provider value={fileOpen}>
    <div className="flex min-h-0 flex-1 flex-col" data-testid="task-detail-mission">
      {compact && (
        <MissionCompactTabs
          active={compactPanel}
          onChange={setCompactPanel}
          overviewRef={overviewTabRef}
          activityRef={activityTabRef}
          infoRef={infoTabRef}
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
            onNodeClick={openDoc}
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
            <MissionActivityFeed feed={model.feed} onArtifactClick={openDoc} onSubrunnerClick={(id) => agents.openFor(id) || openDoc(`subrunner:${id}`)} canOpenAgent={agents.canOpen} commitArtifact={commitArtifact} task={task} visible={!compact || compactPanel === "activity"} />
          )}
        </div>
        <div
          id="mission-panel-info"
          role={compact ? "tabpanel" : undefined}
          aria-labelledby={compact ? "mission-compact-tab-info" : undefined}
          className="mission-panel"
          hidden={compact && compactPanel !== "info"}
          data-testid="mission-panel-info"
        >
          <MissionInfoSidebar key={task.taskId} task={task} compact={compact} visible={!compact || compactPanel === "info"} request={viewerRequest} agents={agents} docs={docs} />
        </div>
      </div>
      <AgentsDock task={task} controller={agents} />
    </div>
    </FileOpenContext.Provider>
  );
}
