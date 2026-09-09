/*
 * MissionTestsAcCoverage — the per-AC regrouping of the Tests artifact's file
 * rows (split from `MissionSlice2Details.tsx` at the 300-LOC rule).
 *
 * A VIEW over `TestsArtifact.detail.acCoverage`, which the server already
 * computes purely from `TestRow.frs[].acIds` — no binding lives here.
 * `tagged: false` (no manifest link anywhere carries an `ac_id`) is the
 * common case in this repo today and MUST render as an explicit "not yet
 * tagged" note, never as an empty or silently-absent section — the exact
 * distinction the triage card that requested this view calls out.
 */

import type { TestsArtifact } from "../../../lib/missionContextApi";
import { acGroupLabel, testChangeWord } from "../../../lib/missionArtifacts";

export function MissionTestsAcCoverage({
  acCoverage,
}: {
  acCoverage: NonNullable<TestsArtifact["detail"]>["acCoverage"];
}) {
  if (!acCoverage.tagged) {
    return (
      <p className="a-note" data-testid="artifact-tests-ac-absent">
        These tests are not yet tagged by acceptance criterion — the table
        above shows coverage by requirement only.
      </p>
    );
  }

  return (
    <ul className="a-rows" data-testid="artifact-tests-ac-groups">
      {acCoverage.groups.map((group) => (
        <li key={`${group.frId}::${group.acId}`} data-testid="artifact-tests-ac-group">
          <strong>{acGroupLabel(group)}</strong>
          <ul className="a-fr-links">
            {group.files.map((file) => (
              <li key={`${file.kind}:${file.path}`} data-testid="artifact-tests-ac-group-file">
                <code>{file.path}</code> — {testChangeWord(file.kind)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
