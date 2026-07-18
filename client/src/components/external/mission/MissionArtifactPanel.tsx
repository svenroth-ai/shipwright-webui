/*
 * MissionArtifactPanel — the RIGHT panel for a context-resolved artifact
 * (CONTRACT §7). Two stacked, cleanly separated regions:
 *
 *   (top)    a plain-language business summary — Mission is FOR NON-EXPERTS,
 *            so this is what a reader sees first;
 *   (bottom) the DETAIL, rendered by its DISCRIMINATED TYPE — a Markdown
 *            document via the existing SmartViewer `DocumentMarkdown`, a
 *            structured requirement list, or commit metadata + PR link.
 *            Not everything is a Markdown file (external-review GPT #13).
 *
 * The document body is fetched ON CLICK by its OPAQUE id — this component never
 * constructs a file path (§5.2). A body that changed or vanished since the
 * context response renders a typed `stale` notice, never an unrelated file.
 *
 * Sibling of the legacy `ArtifactPanel`, which continues to serve scenarios
 * 1/3/4/5 untouched.
 *
 * a11y: role=dialog, Esc closes, focus returns to the node that opened it.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { frRowLabel } from "../../../lib/missionArtifacts";
import { useArtifactDocument } from "../../../hooks/useMissionContext";
import { DocumentMarkdown } from "../SmartViewer/DocumentMarkdown";

interface Props {
  taskId: string;
  artifact: ArtifactDescriptor;
  onClose: () => void;
}

export function MissionArtifactPanel({ taskId, artifact, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnToRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnToRef.current = document.activeElement as HTMLElement | null;
  }, [artifact.kind]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => () => returnToRef.current?.focus?.(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="a-scrim"
        aria-label="Close artifact"
        tabIndex={-1}
        onClick={onClose}
        data-testid="artifact-scrim"
      />
      <aside
        className="artifact"
        role="dialog"
        aria-label={`${artifact.label} artifact`}
        data-testid="mission-artifact-panel"
        data-node={artifact.kind}
      >
        <button
          ref={closeRef}
          type="button"
          className="a-close"
          onClick={onClose}
          aria-label="Close"
          data-testid="artifact-close"
        >
          <X size={18} aria-hidden="true" />
        </button>

        {/* Region 1 — the business summary. */}
        <span className="eyebrow">{artifact.label}</span>
        {artifact.summary ? (
          <p className="a-body" data-testid="artifact-summary">
            {artifact.summary}
          </p>
        ) : null}

        {/* Region 2 — the typed detail. */}
        <div className="a-detail" data-testid="artifact-detail">
          <ArtifactDetail taskId={taskId} artifact={artifact} />
        </div>
      </aside>
    </>
  );
}

/** Discriminated on `kind` — each artifact type renders its own detail shape. */
function ArtifactDetail({ taskId, artifact }: { taskId: string; artifact: ArtifactDescriptor }) {
  if (artifact.kind === "spec") {
    return <SpecDetail taskId={taskId} documentId={artifact.detail?.documentId ?? null} />;
  }
  if (artifact.kind === "requirement") {
    return <RequirementDetail artifact={artifact} />;
  }
  return <CommitDetail artifact={artifact} />;
}

function SpecDetail({ taskId, documentId }: { taskId: string; documentId: string | null }) {
  const doc = useArtifactDocument(taskId, documentId);

  if (!documentId) return <p className="a-note">No document is linked to this artifact.</p>;
  if (doc.isPending) return <p className="a-note" data-testid="artifact-doc-loading">Loading the document…</p>;
  if (doc.isError) return <p className="a-note" data-testid="artifact-doc-error">The document could not be loaded.</p>;

  // A doc that moved or vanished since the context response — typed, never a
  // silently-substituted different file.
  if (doc.data?.status !== "ok") {
    return (
      <p className="a-note" data-testid="artifact-doc-stale">
        This document has changed since it was listed. Reopen the tab to see the current version.
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
