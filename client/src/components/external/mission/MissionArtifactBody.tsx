/*
 * MissionArtifactBody — the CONTENT of a context-resolved artifact (CONTRACT §7):
 * the plain-language business summary over the DISCRIMINATED typed detail.
 *
 * Split out of `MissionArtifactPanel` (iterate-2026-07-23-mission-viewer-scroll-popout)
 * so the SAME render is reused by the inline right-panel and by the pop-out
 * `MissionArtifactModal` — no second copy of the per-kind renderers to drift.
 * The panel/modal own the CHROME (eyebrow, close, pop-out); this owns only the
 * summary + detail. Every `data-testid` is preserved verbatim so the panel's
 * behaviour is unchanged.
 *
 * The document body is fetched ON CLICK by its OPAQUE id — this component never
 * constructs a file path (§5.2). A body that changed or vanished since the
 * context response renders a typed `stale` notice, never an unrelated file.
 */

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { frRowLabel } from "../../../lib/missionArtifacts";
import { useArtifactDocument } from "../../../hooks/useMissionContext";
import { DocumentMarkdown } from "../SmartViewer/DocumentMarkdown";
import { DecisionsDetail, ReviewDetail, TestsDetail } from "./MissionSlice2Details";
import {
  CampaignProgressDetail,
  PhaseDetail,
  SubIterateDetail,
} from "./MissionSlice3Details";

interface Props {
  taskId: string;
  artifact: ArtifactDescriptor;
}

export function MissionArtifactBody({ taskId, artifact }: Props) {
  return (
    <>
      {/* Region 1 — the business summary. */}
      {artifact.summary ? (
        <p className="a-body" data-testid="artifact-summary">
          {artifact.summary}
        </p>
      ) : null}

      {/* Region 2 — the typed detail. */}
      <div className="a-detail" data-testid="artifact-detail">
        <ArtifactDetail taskId={taskId} artifact={artifact} />
      </div>
    </>
  );
}

/** Discriminated on `kind` — each artifact type renders its own detail shape. */
function ArtifactDetail({ taskId, artifact }: { taskId: string; artifact: ArtifactDescriptor }) {
  switch (artifact.kind) {
    case "spec":
      return <SpecDetail taskId={taskId} documentId={artifact.detail?.documentId ?? null} />;
    case "requirement":
      return <RequirementDetail artifact={artifact} />;
    case "tests":
      return <TestsDetail artifact={artifact} />;
    case "review":
      return <ReviewDetail artifact={artifact} />;
    case "decisions":
      return <DecisionsDetail artifact={artifact} />;
    case "commit":
      return <CommitDetail artifact={artifact} />;
    // S3 — pipeline
    case "phase":
      return <PhaseDetail artifact={artifact} />;
    // S3 — campaign. The RUNBOOK is a Markdown document like the spec, so it
    // reuses the same fetch-on-click renderer rather than a second one.
    case "campaign_runbook":
      return <SpecDetail taskId={taskId} documentId={artifact.detail?.documentId ?? null} />;
    case "campaign_progress":
      return <CampaignProgressDetail artifact={artifact} />;
    case "sub_iterate":
      return (
        <SubIterateDetail
          artifact={artifact}
          renderDocument={(id) => <SpecDetail taskId={taskId} documentId={id} />}
        />
      );
  }
}

function SpecDetail({ taskId, documentId }: { taskId: string; documentId: string | null }) {
  const doc = useArtifactDocument(taskId, documentId);

  if (!documentId) return <p className="a-note">No document is linked to this artifact.</p>;
  if (doc.isPending) return <p className="a-note" data-testid="artifact-doc-loading">Loading the document…</p>;
  if (doc.isError) return <p className="a-note" data-testid="artifact-doc-error">The document could not be loaded.</p>;

  // `stale` and `unavailable` are DIFFERENT facts and the §6 state model exists
  // to keep them apart — collapsing them here would reintroduce at the last
  // mile the exact confusion the model prevents everywhere else: a guard
  // rejection or an over-cap document would read as a benign edit.
  if (doc.data?.status === "stale") {
    return (
      <p className="a-note" data-testid="artifact-doc-stale">
        This document has changed since it was listed. Reopen the tab to see the current version.
      </p>
    );
  }
  if (doc.data?.status !== "ok") {
    return (
      <p className="a-note" data-testid="artifact-doc-unavailable">
        This document is currently unavailable — it could not be read safely.
      </p>
    );
  }

  return (
    <div data-testid="artifact-doc-body">
      <DocumentMarkdown text={doc.data.document.body} />
    </div>
  );
}

function RequirementDetail({
  artifact,
}: {
  artifact: Extract<ArtifactDescriptor, { kind: "requirement" }>;
}) {
  const detail = artifact.detail;
  if (!detail) return <p className="a-note">No requirement detail was recorded.</p>;

  return (
    <>
      {/* Mid-run this is PLANNED impact and says so — never presented as a
          decided new/changed classification before Finalize (§6). */}
      <p className="a-note" data-testid="artifact-req-confidence">
        {detail.confidence === "planned"
          ? "Planned impact — this run has not finished yet."
          : detail.confidence === "finalized"
            ? "Recorded at completion."
            : "No requirement could be resolved."}
      </p>
      {detail.rows.length > 0 ? (
        <ul className="a-rows" data-testid="artifact-req-rows">
          {detail.rows.map((row) => (
            <li key={row.originalFrId}>{frRowLabel(row)}</li>
          ))}
        </ul>
      ) : null}
      {detail.specImpact ? (
        <p className="a-note">Spec impact: {detail.specImpact}</p>
      ) : null}
    </>
  );
}

function CommitDetail({
  artifact,
}: {
  artifact: Extract<ArtifactDescriptor, { kind: "commit" }>;
}) {
  const detail = artifact.detail;
  if (!detail) return <p className="a-note">No commit was recorded for this run.</p>;

  const mergeWord =
    detail.merge === "merged"
      ? "Merged"
      : detail.merge === "pending"
        ? "Not merged yet"
        : "Merge state unknown";

  return (
    <dl className="a-meta" data-testid="artifact-commit-meta">
      {detail.commit ? (
        <>
          <dt>Commit</dt>
          <dd>
            <code>{detail.commit.slice(0, 12)}</code>
          </dd>
        </>
      ) : null}
      {detail.message ? (
        <>
          <dt>Message</dt>
          <dd>{detail.message}</dd>
        </>
      ) : null}
      <dt>Delivery</dt>
      <dd data-testid="artifact-commit-merge">{mergeWord}</dd>
      {detail.prUrl && detail.prNumber != null ? (
        <>
          <dt>Pull request</dt>
          <dd>
            {/* External link — opened deliberately, never auto-navigated (§5.1). */}
            <a href={detail.prUrl} target="_blank" rel="noreferrer noopener">
              #{detail.prNumber}
            </a>
          </dd>
        </>
      ) : null}
    </dl>
  );
}
