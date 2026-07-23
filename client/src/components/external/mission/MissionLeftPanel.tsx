/*
 * MissionLeftPanel — the LEFT card of Mission Control, redesigned (FR-01.66).
 *
 * Sven's approved design (2026-07-17): ONE coherent left panel everywhere. It
 * REPLACES A11's "The Record" audit RAIL (the spine + collapse) with three
 * stacked parts:
 *   1. a business-language summary of what this change is about ("what this is"),
 *   2. WHERE IT STANDS NOW — the six fixed stage labels `Analyze · Spec · Build ·
 *      Test · Finalize · Merge` (STAGE_LABELS, verbatim; an honest "—" when the
 *      stage cannot be derived), preceded (for a campaign session) by a
 *      "Sub-iterate N of M · A<k>" progress line (FR-01.67), and
 *   3. the audit trail folded into clickable ARTIFACT LINKS — the same
 *      Req/Spec/Test/Review/Commit `RecordNode`s, each opening in the RIGHT
 *      ArtifactPanel (AC2: no audit information lost, only relocated to links).
 *
 * Presentational + controlled: it invents no copy (the summary/stage come from
 * `useMissionLive`, the node labels/receipts from A10's narrator). Keeps the
 * `record-rail` test id — it is the same left slot, now the artifact-links panel.
 */

import type { CampaignMissionInfo, MissionLiveModel } from "../../../hooks/useMissionLive";
import { STAGE_LABELS, type LifecycleStage } from "../../../lib/narrator-transcript";
import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { ArtifactLink } from "./ArtifactLink";
import { RecordNode } from "./RecordNode";

const EM_DASH = String.fromCodePoint(0x2014);
const MIDDLE_DOT = String.fromCodePoint(0x00b7);

/** The autonomous-campaign progress line — "Sub-iterate N of M · A<k>" — shown
 *  ABOVE the stepper for a campaign session only (FR-01.67). */
function CampaignProgress({ campaign }: { campaign: CampaignMissionInfo }) {
  const suffix = campaign.activeSubIterate ? ` ${MIDDLE_DOT} ${campaign.activeSubIterate}` : "";
  return (
    <p className="ml-campaign-progress" data-testid="mission-campaign-progress">
      {`Sub-iterate ${campaign.done} of ${campaign.total}${suffix}`}
    </p>
  );
}

type StepState = "done" | "current" | "todo";

function stepStateFor(index: number, currentIndex: number, complete: boolean): StepState {
  if (complete) return "done";
  if (currentIndex < 0) return "todo";
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "todo";
}

/**
 * Is this run's change CONFIRMED on the main line? Read from the Commit
 * artifact's real merge state (the squash-aware `checkSquashMerged` result),
 * NOT from the pipeline run-join that `model.stageComplete` depends on — a
 * standalone iterate never has that join, which is why its green "Merge" step
 * never lit up even after the PR merged (Sven, 2026-07-23). A merged run IS the
 * whole lifecycle done, so it drives the stepper to all-done.
 */
function isMergeConfirmed(artifacts?: ArtifactDescriptor[] | null): boolean {
  const commit = artifacts?.find((a) => a.kind === "commit");
  return commit?.kind === "commit" && commit.detail?.merge === "merged";
}

interface StepperProps {
  stage: LifecycleStage | null;
  complete: boolean;
  /**
   * The coarse "what it's doing now" read for a session with no iterate
   * lifecycle (S4 AC5). It replaces the bare em-dash in the same slot — a plain
   * session gets a plain sentence, NOT a claimed position in a lifecycle it is
   * not running. Absent → the honest em-dash, exactly as before.
   */
  activity?: string | null;
}

function StageStepper({ stage, complete, activity }: StepperProps) {
  const currentIndex = stage ? STAGE_LABELS.indexOf(stage) : -1;
  const unknown = currentIndex < 0 && !complete;

  // S4 AC5 (external plan review, GPT finding 8): when the session has NO
  // lifecycle but we do know what it is doing, the six formal step labels are
  // NOT rendered at all. Keeping them — even greyed out — would still frame the
  // work as a position in a lifecycle the session is not running, which is the
  // claim AC5 exists to prevent. Only the plain activity line shows.
  //
  // Note this is strictly narrower than "no stage": with no activity either, the
  // stepper renders exactly as before with the honest em-dash, so a task that
  // has produced nothing yet is visually unchanged.
  if (unknown && activity) {
    return (
      <ol className="ml-stage" data-testid="mission-stage" data-stage="none">
        <li
          className="ml-step-none"
          data-testid="mission-stage-none"
          aria-label={`current activity: ${activity}`}
        >
          {activity}
        </li>
      </ol>
    );
  }

  return (
    <ol className="ml-stage" data-testid="mission-stage" data-stage={stage ?? "none"}>
      {STAGE_LABELS.map((label, i) => {
        const state = stepStateFor(i, currentIndex, complete);
        return (
          <li
            key={label}
            className={`ml-step ${state}`}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="ml-step-dot" aria-hidden="true" />
            <span className="ml-step-label">{label}</span>
            {/* State never rides colour alone (a11y): a screen-reader word. */}
            <span className="sr-only">
              {state === "current" ? " — in progress" : state === "done" ? " — done" : ""}
            </span>
          </li>
        );
      })}
      {unknown ? (
        <li className="ml-step-none" data-testid="mission-stage-none" aria-label="stage not yet known">
          {EM_DASH}
        </li>
      ) : null}
    </ol>
  );
}

interface Props {
  model: MissionLiveModel;
  activeNodeKey: string | null;
  onNodeClick: (key: string) => void;
  /**
   * campaign 2026-07-18-mission-artifacts S1 — the context-resolved artifact
   * rail for a standalone ITERATE. When supplied it REPLACES the legacy
   * `model.nodes` rail; when absent (scenarios 1/3/4/5) the legacy rail renders
   * exactly as before, so this slice cannot regress them.
   */
  artifacts?: ArtifactDescriptor[] | null;
  /**
   * Is the run IN FLIGHT? Only effect: an artifact that has not been written yet
   * renders as a plain "not written yet" entry instead of being hidden.
   */
  runLive?: boolean;
}

export function MissionLeftPanel({
  model,
  activeNodeKey,
  onNodeClick,
  artifacts,
  runLive = false,
}: Props) {
  const { businessSummary, stage, stageActivity, stageComplete, nodes, campaign } = model;
  // A confirmed merge means the whole lifecycle finished — light every step,
  // including "Merge". This is independent of `stageComplete` (the pipeline-only
  // signal), so a standalone iterate's green Merge no longer depends on a join
  // it never has. Left as-is for a live/pending run (the transcript stage still
  // renders "Merge" as the current step).
  const stepperComplete = stageComplete || isMergeConfirmed(artifacts);
  return (
    <nav
      className="record mc-left"
      aria-label="Mission summary and artifacts"
      data-testid="record-rail"
    >
      <section className="ml-block">
        <span className="eyebrow">What this is</span>
        <p className="ml-summary" data-testid="mission-summary">
          {businessSummary ?? "Waiting for the session to describe its work."}
        </p>
      </section>

      <section className="ml-block">
        <span className="eyebrow">Where it stands</span>
        {campaign ? <CampaignProgress campaign={campaign} /> : null}
        <StageStepper stage={stage} complete={stepperComplete} activity={stageActivity} />
      </section>

      <section className="ml-block ml-artifacts">
        <span className="eyebrow">Artifacts</span>
        {artifacts
          ? artifacts.map((a) => (
              <ArtifactLink
                key={a.kind}
                artifact={a}
                active={activeNodeKey === a.kind}
                onClick={() => onNodeClick(a.kind)}
                runLive={runLive}
              />
            ))
          : nodes.map((node) => (
              <RecordNode
                key={node.key}
                node={node}
                active={activeNodeKey === node.key}
                collapsed={false}
                onClick={() => onNodeClick(node.key)}
              />
            ))}
      </section>
    </nav>
  );
}
