/*
 * ArtifactPanel — the evidence panel a Record node opens (FR-01.55, A11).
 *
 * On the immersive photo (every route post-A03) this is the THIRD card in the
 * .mc-body flex row, sitting beside the rail (on-photo.css / mission-record.css
 * make .on-photo .artifact position:static, and hide the scrim). Below the
 * compact breakpoint it falls back to the absolute 420px slide-over with its
 * scrim + slide-in.
 *
 * Honest by construction: the body is the node's narrator CAPTION + its honest
 * receipt — it NEVER fabricates a spec diff, a test-name list or a commit stat
 * the run did not report (the prototype faked those; Fable B3). "Open full
 * document" routes to the EXISTING SmartViewer / Files & Terminal surface — it
 * does not re-implement a viewer.
 *
 * a11y: role=dialog, keyboard-reachable, Esc closes, and focus RETURNS to the
 * node that opened it (the element focused at mount is restored on unmount).
 */

import { useEffect, useRef } from "react";
import { ChevronRight, X } from "lucide-react";

import type { RecordNodeView } from "../../../lib/recordNodes";

/** The artifact's title line: the name of the thing, not a fabricated value.
 *  (At a design gate the `spec` node is relabeled "Design" — its artifact is
 *  still the spec, so "spec.md" is the honest title.) */
function artifactTitle(node: RecordNodeView): string {
  if (node.key === "spec") return "spec.md";
  return node.receipt ?? "No run data yet";
}

interface Props {
  node: RecordNodeView;
  onClose: () => void;
  /** Routes to the existing SmartViewer / Files & Terminal surface. */
  onOpenDocument: () => void;
}

export function ArtifactPanel({ node, onClose, onOpenDocument }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnToRef = useRef<HTMLElement | null>(null);

  // Track the element that triggered the CURRENTLY-shown node: runs on open AND
  // on every node switch (the just-clicked node still holds focus here, before
  // focus moves to the close control), so closing after A→B returns focus to B,
  // not the original A.
  useEffect(() => {
    returnToRef.current = document.activeElement as HTMLElement | null;
  }, [node.key]);

  // Focus the close control once on open (not on every node switch — that would
  // yank focus off the node the user just clicked).
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Restore focus to the current trigger on close/unmount.
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
      {/* Scrim: CSS hides it on the on-photo desktop inline card; it only shows
          (and dims) in the compact slide-over fallback. */}
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
        aria-label={`${node.label} artifact`}
        data-testid="artifact-panel"
        data-node={node.key}
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
        <span className="eyebrow">{node.label}</span>
        <h3>{artifactTitle(node)}</h3>
        <p className="a-body">{node.caption}</p>
        <button
          type="button"
          className="a-open"
          onClick={onOpenDocument}
          data-testid="artifact-open-document"
        >
          Open full document
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </aside>
    </>
  );
}
