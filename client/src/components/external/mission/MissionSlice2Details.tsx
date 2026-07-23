/*
 * MissionSlice2Details — the RIGHT-panel detail bodies for Tests · Review ·
 * Decisions (CONTRACT §7, campaign 2026-07-18-mission-artifacts Slice 2).
 *
 * Its own module because `MissionArtifactPanel.tsx` sits near the 300-LOC rule
 * and these three are the richest detail shapes in the feature. The panel keeps
 * the chrome and the discrimination; this file renders the bodies.
 *
 * Each one is a DIFFERENT discriminated type, per §7 — an RTM table, a findings
 * list, ADR Markdown. Nothing here invents copy: every string is either a
 * server-supplied field or a fixed plain-language label.
 *
 * The honesty rules that survive review, restated where they are enforced:
 *   - a MISSING traceability manifest renders as "links unavailable", never as
 *     a test that covers nothing;
 *   - a review with no readable record renders as "no record", never as a
 *     clean pass, and a findings COUNT with no per-finding detail says so
 *     instead of showing an empty list.
 */

import type {
  DecisionsArtifact,
  ReviewArtifact,
  ReviewFinding,
  ReviewRow,
  TestsArtifact,
} from "../../../lib/missionContextApi";
import { reviewStatusWord } from "../../../lib/missionWording";
import {
  layerWord,
  reviewTypeLabel,
  testChangeWord,
  testFrLabel,
  testsResultText,
} from "../../../lib/missionArtifacts";
import { DocumentMarkdown } from "../SmartViewer/DocumentMarkdown";

/** The structured RTM table (§6 row 3 right-detail type). */
export function TestsDetail({ artifact }: { artifact: TestsArtifact }) {
  const detail = artifact.detail;
  if (!detail) return <p className="a-note">No test result was recorded for this run.</p>;

  // The pass/total the run recorded LEADS: it is present even when the worktree
  // flow shipped `commit:""` and there is no per-file diff to show below.
  const resultText = testsResultText(detail.results);
  const hasRows = detail.rows.length > 0;

  return (
    <>
      {resultText ? (
        <p className="a-tests-result" data-testid="artifact-tests-result">
          {resultText}
        </p>
      ) : null}

      {/* The file table + its counts are the ENRICHMENT — only when a real
          commit diff resolved. A counts-only run shows its result above and an
          honest note here, not an empty table. */}
      {!hasRows ? (
        <p className="a-note" data-testid="artifact-tests-no-files">
          No test-file changes were recorded for this run.
        </p>
      ) : (
        <TestsFileTable detail={detail} />
      )}
    </>
  );
}

/** The per-file RTM table — rendered only when the run recorded a diff. */
function TestsFileTable({ detail }: { detail: NonNullable<TestsArtifact["detail"]> }) {
  return (
    <>
      <p className="a-note" data-testid="artifact-tests-counts">
        {`${detail.counts.added} added · ${detail.counts.modified} changed · ${detail.counts.removed} removed`}
      </p>

      {/* A missing OR PARTIAL manifest costs the LINKS, not the tests. The
          wording is true in both cases — the index may be entirely absent or
          merely capped, and claiming "unavailable" for a partial index would be
          as wrong as claiming "fine". */}
      {detail.manifestStatus === "unavailable" ? (
        <p className="a-note" data-testid="artifact-tests-links-unavailable">
          Requirement links could not be resolved for every test, so some are shown without them.
        </p>
      ) : null}

      <table className="a-rtm" data-testid="artifact-tests-table">
        <thead>
          <tr>
            <th scope="col">Test file</th>
            <th scope="col">Change</th>
            <th scope="col">Layer</th>
            <th scope="col">Requirement</th>
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => (
            <tr key={`${row.kind}:${row.path}`} data-testid="artifact-tests-row" data-kind={row.kind}>
              <td>
                <code>{row.path}</code>
              </td>
              <td data-testid="artifact-tests-change">{testChangeWord(row.kind)}</td>
              <td>{layerWord(row.layer)}</td>
              <td>
                {row.frs.length === 0 ? (
                  <span className="a-muted">—</span>
                ) : (
                  <ul className="a-fr-links">
                    {row.frs.map((fr) => (
                      /* "mapped from FR-01.44" — the fold provenance (AC2). */
                      <li key={fr.frId} data-testid="artifact-tests-fr">
                        {testFrLabel(fr)}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail.truncated ? (
        <p className="a-note" data-testid="artifact-tests-truncated">
          This run changed more test files than are shown here.
        </p>
      ) : null}
    </>
  );
}

/** One review pass. Kept small so the four rows read uniformly. */
function ReviewFindingItem({ finding }: { finding: ReviewFinding }) {
  return (
    <li data-testid="artifact-review-finding">
      {finding.severity ? (
        <span className="a-review-severity" data-severity={finding.severity}>
          {finding.severity}
        </span>
      ) : null}
      <span className="a-review-finding-text">{finding.title}</span>
      {finding.location ? (
        <span className="a-review-location" data-testid="artifact-review-location">
          {finding.location}
        </span>
      ) : null}
      {finding.suggestion ? (
        <span className="a-review-suggestion">{finding.suggestion}</span>
      ) : null}
    </li>
  );
}

function ReviewRowItem({ row }: { row: ReviewRow }) {
  // A review that RAN but whose prose could not be itemized has a count of 0
  // for a review that may have found plenty. Showing "0 issues" would let a
  // skimming reader complete it as "found nothing" — so the count is SUPPRESSED
  // and only the caveat renders.
  const unitemized = row.status === "completed" && row.parseStatus === "unstructured";
  // `partial` means part of the reviewer's output could not be itemized, so the
  // count is known to UNDERSTATE what was found. Same class of fabrication as
  // `unstructured`, differing only in degree — so the count is shown (it is a
  // real floor) but never presented as complete.
  const undercount = row.status === "completed" && row.parseStatus === "partial";
  const hasCount = row.status === "completed" && row.findingsCount != null && !unitemized;
  // Only the marker path can report a count with no detail behind it; a record
  // guarantees `findingsCount === findings.length`.
  const countWithoutDetail =
    row.source === "marker" && hasCount && row.findingsCount! > 0 && row.findings.length === 0;

  return (
    <li data-testid="artifact-review-row" data-review-type={row.reviewType} data-status={row.status}>
      <span className="a-review-name">{reviewTypeLabel(row.reviewType)}</span>{" "}
      <span className="a-review-status" data-testid="artifact-review-status">
        {reviewStatusWord(row.status)}
      </span>
      {hasCount ? (
        <span className="a-review-count" data-testid="artifact-review-count">
          {` — ${row.findingsCount} ${row.findingsCount === 1 ? "issue" : "issues"}`}
        </span>
      ) : null}
      {unitemized ? (
        <p className="a-note" data-testid="artifact-review-unitemized">
          This review ran, but its findings could not be read back individually —
          so this is not a “nothing found” result.
        </p>
      ) : null}
      {undercount ? (
        <p className="a-note" data-testid="artifact-review-partial">
          Part of this review could not be read back individually, so it may have
          found more than the number shown.
        </p>
      ) : null}
      {countWithoutDetail ? (
        <p className="a-note" data-testid="artifact-review-no-detail">
          The individual findings were not recorded, only the count.
        </p>
      ) : null}
      {row.truncated ? (
        <p className="a-note" data-testid="artifact-review-truncated">
          This review recorded more findings than are shown here.
        </p>
      ) : null}
      {row.findings.length > 0 ? (
        <ul className="a-review-findings">
          {row.findings.map((f, i) => (
            <ReviewFindingItem key={`${f.title}:${i}`} finding={f} />
          ))}
        </ul>
      ) : null}
      {row.note ? <p className="a-note">{row.note}</p> : null}
      {row.disposition ? (
        <p className="a-note" data-testid="artifact-review-disposition">
          {row.disposition}
        </p>
      ) : null}
    </li>
  );
}

/** The findings list (§6 row 4 right-detail type) — always all four passes. */
export function ReviewDetail({ artifact }: { artifact: ReviewArtifact }) {
  const detail = artifact.detail;
  if (!detail) return <p className="a-note">No review record was found for this run.</p>;

  return (
    <ul className="a-reviews" data-testid="artifact-review-rows">
      {detail.rows.map((row) => (
        <ReviewRowItem key={row.reviewType} row={row} />
      ))}
    </ul>
  );
}

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
  if (!detail || detail.entries.length === 0) {
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
              Decided — not yet published in a release.
            </p>
          ) : null}
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
    </>
  );
}
