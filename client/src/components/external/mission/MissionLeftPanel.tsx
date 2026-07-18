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

function StageStepper({ stage, complete }: { stage: LifecycleStage | null; complete: boolean }) {
  const currentIndex = stage ? STAGE_LABELS.indexOf(stage) : -1;
  const unknown = currentIndex < 0 && !complete;
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
}

export function MissionLeftPanel({ model, activeNodeKey, onNodeClick, artifacts }: Props) {
  const { businessSummary, stage, stageComplete, nodes, campaign } = model;
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
        <StageStepper stage={stage} complete={stageComplete} />
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
