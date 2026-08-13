/*
 * OperationCard — the MIDDLE card of Mission Control (FR-01.56, A12).
 *
 * The answer to "what happened, and can it ship?", in up to three stacked parts:
 *   1. a DERIVED verdict banner (VerdictBanner) — ONLY for `clear`/`hold`, an
 *      earned, specific verdict. A `neutral` outcome renders NO banner
 *      (iterate-2026-08-13-mission-mobile-visual): `ProofSummary` already
 *      carries its own honest "No run data yet — nothing to prove" empty
 *      state when there are no facts, so a second fact-free "No run data
 *      yet"/"Not fully verified" banner on top was pure redundancy either
 *      way — with real proof lines (a red suite line, say) or without.
 *   2. a one-sentence narrator mission line (MissionLine), and
 *   3. a curated, READ-ONLY proof summary (ProofSummary — NOT the terminal).
 *
 * State comes from A11's `useMissionState` — this card CONSUMES it and never
 * re-derives its own copy (AC1). The per-run facts come from A02's `useRunDetail`
 * (the same join the Record rail reads), so the verdict and the Record can never
 * disagree. `designgate` routes to A14's design-gate surface; until A14 lands this
 * renders an HONEST placeholder (the narrator's design line) — never a fake
 * verdict. `ProofSummary`/`MissionLine` render unconditionally regardless of the
 * banner, so `proofLines.ts`'s guarantee that a red test suite is never hidden
 * behind a neutral verdict is untouched by the banner's own visibility.
 *
 * Architecture rule 1: this is a read-only observer. Its proof lines are rendered
 * history, not a channel — no xterm, no pty, no WebSocket (asserted, AC2).
 */

import type { ExternalTask } from "../../../lib/externalApi";
import type { MissionContext } from "../../../lib/missionContextApi";
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
  context?: MissionContext | null;
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

export function OperationCard({ task, context }: Props) {
  const missionState = useMissionState(task);
  const iterateContext = context?.scenario === "iterate" ? context : null;
  // An iterate's identity is owned by MissionContext. A missing context id is
  // an honest lack of identity, never permission to join a pipeline run.
  const runDetail = useRunDetail(task.projectId, iterateContext ? iterateContext.runId ?? null : task.runId ?? null);
  const joinedFacts: ProofFacts | null = runDetail.data?.status === "ok" ? runDetail.data.run : null;
  const tests = iterateContext?.artifacts.find((artifact) => artifact.kind === "tests");
  const commit = iterateContext?.artifacts.find((artifact) => artifact.kind === "commit");
  const facts: ProofFacts | null = iterateContext
    ? iterateContext.runId ? {
      runId: iterateContext.runId,
      commit: commit?.kind === "commit" ? commit.detail?.commit ?? null : null,
      affectedFrs: iterateContext.servesFrId ? [iterateContext.servesFrId] : [],
      tests: tests?.kind === "tests" ? tests.detail?.results : null,
      gates: { test: tests?.kind === "tests" ? tests.detail?.results?.gate ?? "unknown" : "unknown", review: "unknown", security: "unknown" },
    } : null
    : joinedFacts;

  if (missionState === "designgate") {
    // A12 ROUTES the middle slot to A14's real design-gate body — the gallery of
    // pending screens + the Approve / Request-changes decision bar, in this same
    // `.mc-op` white-glass card (no new page/route/header/glass recipe, AC1).
    return <DesignGateCard task={task} />;
  }

  const verdict = deriveVerdict({ facts });
  const proofLines = deriveProofLines({ facts, verdict });
  const missionInput = missionInputFor(verdict.outcome);

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
      ) : null}
      {missionInput ? <MissionLine input={missionInput} /> : null}
      <ProofSummary lines={proofLines} />
    </section>
  );
}
