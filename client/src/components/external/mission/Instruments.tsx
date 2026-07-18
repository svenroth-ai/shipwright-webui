/*
 * Instruments — the three .instr chips of the Mission top row (FR-01.55, A11):
 * Grade · Tests · Serves. A13 slots this into .mc-top; A11 ships it as the
 * component (do NOT rebuild the rest of the top row here).
 *
 * Provenance honesty (AC5): Grade is `real` (compliance-reader / FR-01.43).
 * The prototype tags Tests + Serves `derivable`, but they are `reader` data:
 * with run data they show live values; WITHOUT it they render "—" /
 * "no run data yet" — NEVER a fabricated number.
 *
 * S1 (campaign 2026-07-18-mission-artifacts, AC8) — Tests + Serves previously
 * read `useRunDetail(task.runId)`, which is EMPTY on every standalone iterate
 * (an iterate has no `task.runId`; that field is pipeline-shaped). That is why
 * both chips always showed "—" on an iterate. They now prefer the
 * mission-context resolver — which joins by the iterate's own `run_id` — and
 * fall back to the run-detail join for pipeline runs. Grade is unchanged.
 */

import type { ExternalTask } from "../../../lib/externalApi";
import { useProjectCompliance } from "../../../hooks/useProjectCompliance";
import { useRunDetail } from "../../../hooks/useRunData";
import { useMissionContext } from "../../../hooks/useMissionContext";
import { servesChipValue, testsChipValue } from "../../../lib/missionArtifacts";

const EMPTY = "—";

interface Props {
  task: ExternalTask;
}

export function Instruments({ task }: Props) {
  const compliance = useProjectCompliance(task.projectId);
  const runDetail = useRunDetail(task.projectId, task.runId ?? null);
  const context = useMissionContext(task.taskId);

  const grade = compliance.data?.status === "ok" ? compliance.data.grade : null;

  const run = runDetail.data?.status === "ok" ? runDetail.data.run : null;
  const runTests = run?.tests;
  const runTestsValue =
    runTests && runTests.passed != null && runTests.total != null
      ? `${runTests.passed}/${runTests.total}`
      : null;

  // Resolver first (the iterate path), run-detail second (the pipeline path).
  // Both are honest-or-null, so the chip still shows "—" when neither has data.
  const testsValue = testsChipValue(context.data) ?? runTestsValue;
  const serves = servesChipValue(context.data) ?? run?.affectedFrs?.[0] ?? null;

  return (
    <div
      className="hidden items-center gap-2 md:flex"
      data-testid="mission-instruments"
      aria-label="Run instruments"
    >
      <Chip
        label="Grade"
        value={grade}
        highlight
        emptyHint="grade not available yet"
        testid="instr-grade"
      />
      <Chip
        label="Tests"
        value={testsValue}
        emptyHint="no run data yet"
        testid="instr-tests"
      />
      <Chip
        label="Serves"
        value={serves}
        emptyHint="no run data yet"
        testid="instr-serves"
      />
    </div>
  );
}

function Chip({
  label,
  value,
  highlight,
  emptyHint,
  testid,
}: {
  label: string;
  value: string | null;
  highlight?: boolean;
  emptyHint: string;
  testid: string;
}) {
  const empty = value == null;
  return (
    <span
      className={`instr${highlight ? " hl" : ""}`}
      data-testid={testid}
      data-empty={empty || undefined}
    >
      <span className="il">{label}</span>
      <b aria-label={empty ? `${label}: ${emptyHint}` : undefined}>
        {empty ? EMPTY : value}
      </b>
    </span>
  );
}
