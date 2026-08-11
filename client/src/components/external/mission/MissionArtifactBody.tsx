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

import { useEffect, useRef, useState } from "react";
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
  showSummary?: boolean;
}

export function MissionArtifactBody({ taskId, artifact, showSummary = true }: Props) {
  return (
    <>
      {/* Region 1 — the business summary. */}
      {showSummary && artifact.summary ? (
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
      return <RequirementDetail taskId={taskId} artifact={artifact} />;
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
  taskId,
  artifact,
}: {
  taskId: string;
  artifact: Extract<ArtifactDescriptor, { kind: "requirement" }>;
}) {
  const detail = artifact.detail;
  if (!detail) return <p className="a-note">No requirement detail was recorded.</p>;

  const lifecycle = detail.lifecycle ?? (detail.confidence === "planned" ? "planned" : detail.confidence === "finalized" ? "recorded" : "discovering");
  const lifecycleText = {
    discovering: "Discovering affected requirements.",
    planned: "Planned requirement impact — this run has not finished yet.",
    recorded: "Recorded requirement impact at completion.",
    none: "No requirement changed.",
  }[lifecycle];

  return (
    <>
      <p className="a-note" data-testid="artifact-req-confidence">
        {lifecycleText}
      </p>
      {detail.rows.length > 0 ? (
        <ul className="a-rows" data-testid="artifact-req-rows">
          {detail.rows.map((row) => (
            <li key={row.originalFrId} data-testid="artifact-req-row">
              <strong>{frRowLabel(row)}</strong>
              {row.area ? <span className="a-muted"> · {row.area}</span> : null}
              {row.description ? <p className="a-note">{row.description}</p> : null}
              {detail.sourceDocument ? (
                <RequirementSource taskId={taskId} documentId={detail.sourceDocument.documentId} frId={row.displayFrId} anchor={row.sourceAnchor ?? null} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {detail.specImpact ? (
        <p className="a-note">Spec impact: {detail.specImpact}</p>
      ) : null}
    </>
  );
}

function RequirementSource({ taskId, documentId, frId, anchor }: { taskId: string; documentId: string; frId: string; anchor: string | null }) {
  const [open, setOpen] = useState(false);
  const doc = useArtifactDocument(taskId, open ? documentId : null);
  const sourceAnchor = anchor ?? `fr-${frId.slice(3).replace(".", "")}`;
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const escapedFrId = frId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sourceRowPattern = new RegExp("^\\|\\s*`?" + escapedFrId + "`?\\s*\\|");
  const sourceRow = doc.data?.status === "ok"
    ? doc.data.document.body.split(/\r?\n/).find((line) => sourceRowPattern.test(line)) ?? null
    : null;

  useEffect(() => {
    if (open && sourceRow) sourceRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, sourceRow]);

  return (
    <div className="a-requirement-source">
      <a
        href={`#${sourceAnchor}`}
        className="a-popout"
        onClick={() => setOpen((value) => !value)}
        data-testid="artifact-req-source"
      >
        {open ? "Hide requirements specification" : `Open requirements specification — ${frId}`}
      </a>
      {open && doc.data?.status === "ok" ? (
        <div data-testid="artifact-req-source-document">
          {sourceRow ? (
            <div id={sourceAnchor} ref={sourceRef} tabIndex={-1} data-testid="artifact-req-source-row">
              <p className="a-note">Cited requirement row: <code>{sourceRow}</code></p>
            </div>
          ) : (
            <p className="a-note">The cited requirement row is no longer present in this version of the specification.</p>
          )}
          <DocumentMarkdown text={doc.data.document.body} />
        </div>
      ) : null}
      {open && doc.data?.status !== "ok" && !doc.isPending ? <p className="a-note">The requirements specification is currently unavailable.</p> : null}
    </div>
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
