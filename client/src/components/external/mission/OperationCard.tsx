/*
 * OperationCard — the MIDDLE card of Mission Control (FR-01.56, A12).
 *
 * The answer to "what happened, and can it ship?", in three stacked parts:
 *   1. a DERIVED verdict banner (VerdictBanner),
 *   2. a one-sentence narrator mission line (MissionLine), and
 *   3. a curated, READ-ONLY proof summary (ProofSummary — NOT the terminal).
 *
 * State comes from A11's `useMissionState` — this card CONSUMES it and never
 * re-derives its own copy (AC1). The per-run facts come from A02's `useRunDetail`
 * (the same join the Record rail reads), so the verdict and the Record can never
 * disagree. `designgate` routes to A14's design-gate surface; until A14 lands this
 * renders an HONEST placeholder (the narrator's design line) — never a fake
 * verdict.
 *
 * Architecture rule 1: this is a read-only observer. Its proof lines are rendered
 * history, not a channel — no xterm, no pty, no WebSocket (asserted, AC2).
 */

import type { ExternalTask } from "../../../lib/externalApi";
import { useMissionState } from "../../../hooks/useMissionState";
import { useRunDetail } from "../../../hooks/useRunData";
import { deriveProofLines, deriveVerdict, type ProofFacts } from "../../../lib/proofLines";
import { type MissionInput } from "../../../lib/narrator";
import { VerdictBanner } from "./VerdictBanner";
import { MissionLine } from "./MissionLine";
import { ProofSummary } from "./ProofSummary";
import { DesignGateCard } from "./DesignGateCard";

interface Props {
  task: ExternalTask;
}

/** The narrator mission line for the current verdict, or null when there is no
 *  narratable sentence (a neutral no-data / in-progress state — the banner
 *  carries the message; the narrator has no in-progress line to invent). */
function missionInputFor(
  outcome: "clear" | "hold" | "neutral",
): MissionInput | null {
  if (outcome === "clear") {
    // No change/file counts on the wire (RunDataJoin has none) — the narrator
    // drops the absent counts; only the honest "every check green." remains.
    return { state: "complete", changeCount: null, fileCount: null, allGreen: true };
  }
  if (outcome === "hold") return { state: "hold" };
  return null;
}

export function OperationCard({ task }: Props) {
  const missionState = useMissionState(task);
  const runDetail = useRunDetail(task.projectId, task.runId ?? null);
  const facts: ProofFacts | null =
    runDetail.data?.status === "ok" ? runDetail.data.run : null;

  if (missionState === "designgate") {
    // A12 ROUTES the middle slot to A14's real design-gate body — the gallery of
    // pending screens + the Approve / Request-changes decision bar, in this same
    // `.mc-op` white-glass card (no new page/route/header/glass recipe, AC1).
    return <DesignGateCard task={task} />;
  }

  const verdict = deriveVerdict({ facts });
  const proofLines = deriveProofLines({ facts, verdict });
  const missionInput = missionInputFor(verdict.outcome);
  // The neutral banner's honest reason: a LIVE run is "in progress"; a run with no
  // join is "no run data yet"; a finished run whose gates are not all affirmatively
  // green (today's real state — review/security are unwired) is "not fully
  // verified" — NEVER "in progress" for a done task (it isn't running).
  const neutralReason: "in-progress" | "no-data" | "unverified" =
    missionState === "live" ? "in-progress" : facts == null ? "no-data" : "unverified";

  return (
    <section
      className="mc-op"
      data-testid="operation-card"
      data-state={missionState}
      data-outcome={verdict.outcome}
    >
      {verdict.outcome === "clear" ? (
        <VerdictBanner outcome="clear" tests={facts?.tests ?? null} />
      ) : verdict.outcome === "hold" ? (
        <VerdictBanner outcome="hold" />
      ) : (
        <VerdictBanner outcome="neutral" reason={neutralReason} />
      )}
      {missionInput ? <MissionLine input={missionInput} /> : null}
      <ProofSummary lines={proofLines} />
    </section>
  );
}
