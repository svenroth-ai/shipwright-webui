/*
 * MissionSlice3Details — right-panel detail renderers for the native pipeline
 * and campaign artifacts (CONTRACT §7, S3).
 *
 * Sibling of `MissionSlice2Details`. Same register throughout: Mission is FOR
 * NON-EXPERTS, so every enum is translated, every id is labelled, and anything
 * we do not know says so in words instead of showing a plausible-looking zero.
 *
 * `outputs` are rendered as TEXT, never as links. The producer records them as
 * bare relative strings with no documented root, so a link built from one would
 * be a guess — and a guess that resolves to nothing is the dead link AC3 forbids.
 */

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import {
  selectionWord,
  testCountLabel,
  unitStatusWord,
} from "../../../lib/missionWording";

type Of<K extends ArtifactDescriptor["kind"]> = Extract<ArtifactDescriptor, { kind: K }>;

/** `2026-04-25T08:34:11Z` → a readable local timestamp; null stays absent. */
function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function PhaseDetail({ artifact }: { artifact: Of<"phase"> }) {
  const d = artifact.detail;
  if (!d) return <p className="a-note">No pipeline step details were recorded.</p>;

  const started = when(d.startedAt);
  const finished = when(d.completedAt);

  return (
    <>
      <dl className="a-meta" data-testid="artifact-phase-meta">
        <dt>Step</dt>
        <dd>{d.title ?? d.phase}</dd>
        {d.splitId ? (
          <>
            <dt>Part</dt>
            <dd>{d.splitId}</dd>
          </>
        ) : null}
        <dt>State</dt>
        <dd data-testid="artifact-phase-status">{unitStatusWord(d.status)}</dd>
        {started ? (
          <>
            <dt>Started</dt>
            <dd>{started}</dd>
          </>
        ) : null}
        {finished ? (
          <>
            <dt>Finished</dt>
            <dd>{finished}</dd>
          </>
        ) : null}
        {d.executionCount != null && d.executionCount > 1 ? (
          <>
            <dt>Attempts</dt>
            <dd>{d.executionCount}</dd>
          </>
        ) : null}
        <dt>Run</dt>
        <dd>
          <code>{d.runId}</code>
        </dd>
      </dl>

      {d.errors.length > 0 ? (
        <>
          <p className="a-note">What went wrong:</p>
          <ul className="a-rows" data-testid="artifact-phase-errors">
            {d.errors.map((e, i) => (
              <li key={`${i}-${e.slice(0, 24)}`}>{e}</li>
            ))}
          </ul>
        </>
      ) : null}

      {d.outputs.length > 0 ? (
        <>
          <p className="a-note">This step recorded producing:</p>
          <ul className="a-rows" data-testid="artifact-phase-outputs">
            {d.outputs.map((o) => (
              <li key={o}>
                <code>{o}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

export function CampaignProgressDetail({ artifact }: { artifact: Of<"campaign_progress"> }) {
  const d = artifact.detail;
  if (!d) return <p className="a-note">No campaign progress was recorded.</p>;

  return (
    <>
      <dl className="a-meta" data-testid="artifact-campaign-meta">
        <dt>Campaign</dt>
        <dd>{d.slug}</dd>
        {d.lifecycle ? (
          <>
            <dt>State</dt>
            <dd>{d.lifecycle}</dd>
          </>
        ) : null}
        {d.branchStrategy ? (
          <>
            <dt>Runs its units</dt>
            <dd>{d.branchStrategy === "serial" ? "one after another" : d.branchStrategy}</dd>
          </>
        ) : null}
        <dt>Progress</dt>
        <dd>{`${d.done} of ${d.total} complete`}</dd>
      </dl>

      {d.rows.length > 0 ? (
        <ul className="a-rows" data-testid="artifact-campaign-rows">
          {d.rows.map((r) => (
            <li key={r.id} data-active={r.active ? "true" : undefined}>
              {`${r.id} — ${r.title} · ${unitStatusWord(r.status)}`}
              {r.active ? <span className="a-tag"> current</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function SubIterateDetail({
  artifact,
  renderDocument,
}: {
  artifact: Of<"sub_iterate">;
  /** The panel supplies the document renderer — this module fetches nothing. */
  renderDocument: (documentId: string) => React.ReactNode;
}) {
  const d = artifact.detail;
  if (!d) return <p className="a-note">No current unit was recorded.</p>;

  return (
    <>
      <p className="a-note" data-testid="artifact-sub-basis">
        {selectionWord(d.selectedBy)}
      </p>

      <dl className="a-meta" data-testid="artifact-sub-meta">
        <dt>Unit</dt>
        <dd>{`${d.id} — ${d.title}`}</dd>
        <dt>State</dt>
        <dd>{unitStatusWord(d.status)}</dd>
        <dt>Tests</dt>
        {/* "not recorded" is a real answer here and must not read as zero. */}
        <dd data-testid="artifact-sub-tests">{testCountLabel(d.testsPassed, d.testsTotal)}</dd>
        {d.branch ? (
          <>
            <dt>Branch</dt>
            <dd>
              <code>{d.branch}</code>
            </dd>
          </>
        ) : null}
        {d.commit ? (
          <>
            <dt>Commit</dt>
            <dd>
              <code>{d.commit.slice(0, 12)}</code>
            </dd>
          </>
        ) : null}
      </dl>

      {d.documentId ? (
        <div data-testid="artifact-sub-doc">{renderDocument(d.documentId)}</div>
      ) : (
        <p className="a-note">This unit has no written brief on disk.</p>
      )}
    </>
  );
}
