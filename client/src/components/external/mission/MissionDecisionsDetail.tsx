/*
 * MissionDecisionsDetail — the RIGHT-panel Decisions body (CONTRACT §6 row 5):
 * the run's ADRs, then its documentation updates.
 *
 * Split out of `MissionSlice2Details.tsx` at the 300-LOC rule when the
 * documentation updates arrived (events-drop-files, issue 978, unit S5b).
 *
 * A documentation update is a one-line bullet the run adds to Architecture or
 * Conventions. While no release has folded it, it lives as its own small file
 * ("pending"); after the release it is a line of the document ("folded"). Both
 * are the same update and are shown the same way — only the one-line note says
 * whether it is already in the published document. A bullet is NEVER an ADR,
 * so it never renders as a decision entry.
 */

import type { DecisionsArtifact, DocUpdateView } from "../../../lib/missionContextApi";
import { DocumentMarkdown } from "../SmartViewer/DocumentMarkdown";

const TARGET_WORD: Record<DocUpdateView["target"], string> = {
  architecture: "Architecture",
  conventions: "Conventions",
};

/**
 * The ADR Markdown (§6 row 5 right-detail type), via the SmartViewer renderer.
 *
 * An entry with no `adrId` is NOT an error and must not look like one. It is a
 * decision recorded at the iterate's F3 whose ADR number is assigned later, when
 * a release aggregates it — the ordinary state of every unmerged run. It gets a
 * plain-language badge saying exactly that, and no number is invented for it.
 */
export function DecisionsDetail({ artifact }: { artifact: DecisionsArtifact }) {
  const detail = artifact.detail;
  const docUpdates = detail?.docUpdates ?? [];
  if (!detail || (detail.entries.length === 0 && docUpdates.length === 0 && !detail.docUpdateConflicts)) {
    return <p className="a-note">This run recorded no decisions.</p>;
  }

  return (
    <>
      {detail.entries.map((entry, i) => (
        <section
          // `adrId` is null for an unnumbered decision, so it cannot be the key.
          key={`${entry.source}:${entry.adrId ?? i}`}
          data-testid="artifact-decision-entry"
          data-adr={entry.adrId ?? ""}
          data-source={entry.source}
        >
          {entry.source === "drop" ? (
            <p className="a-note" data-testid="artifact-decision-unnumbered">
              Recorded — ADR number assigned at release.
            </p>
          ) : entry.adrId ? (
            <p className="a-note" data-testid="artifact-decision-published">
              Published as {entry.adrId}.
            </p>
          ) : (
            <p className="a-note" data-testid="artifact-decision-unverified">
              This published decision has no reliable ADR number.
            </p>
          )}
          <DocumentMarkdown text={entry.markdown} />
        </section>
      ))}
      {detail.truncated ? (
        <p className="a-note" data-testid="artifact-decisions-truncated">
          This run recorded more decisions than are shown here.
        </p>
      ) : null}
      {detail.malformedCount > 0 ? (
        <p className="a-note" data-testid="artifact-decisions-malformed">
          {detail.malformedCount === 1
            ? "One further decision record could not be read."
            : `${detail.malformedCount} further decision records could not be read.`}
        </p>
      ) : null}
      <DocUpdates updates={docUpdates} conflicts={detail.docUpdateConflicts ?? 0} />
    </>
  );
}

function DocUpdates({ updates, conflicts }: { updates: DocUpdateView[]; conflicts: number }) {
  if (updates.length === 0 && conflicts === 0) return null;
  return (
    <section data-testid="artifact-doc-updates">
      <h4>Documentation updates</h4>
      {updates.map((u, i) => (
        <div key={`${u.target}:${i}`} data-testid="artifact-doc-update" data-state={u.state} data-target={u.target}>
          <p className="a-note">
            {u.state === "folded"
              ? `In ${TARGET_WORD[u.target]} (${u.doc}).`
              : `For ${TARGET_WORD[u.target]} — added to ${u.doc} at the next release.`}
          </p>
          <DocumentMarkdown text={u.text} />
        </div>
      ))}
      {conflicts > 0 ? (
        <p className="a-note" data-testid="artifact-doc-update-conflicts">
          {conflicts === 1
            ? "One further update says something different about a point that already has an entry; the release leaves it for a person to decide."
            : `${conflicts} further updates say something different about points that already have an entry; the release leaves them for a person to decide.`}
        </p>
      ) : null}
    </section>
  );
}
