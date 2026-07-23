/*
 * MissionArtifactPanel — the RIGHT panel for a context-resolved artifact
 * (CONTRACT §7). It owns the CHROME only — the eyebrow label, the pop-out + close
 * toolbar, and the pop-out modal state. The two stacked, cleanly separated
 * regions (business summary over the discriminated typed detail) live in the
 * shared `MissionArtifactBody`, so the inline panel and the pop-out modal render
 * the identical content.
 *
 * The card scrolls INTERNALLY (`.artifact { overflow-y:auto }`) now that the
 * Mission body is a bounded flex column (see MissionBody) — a long Spec /
 * Requirement no longer pushes the whole page. "Pop out" opens the same content
 * centered and larger (like the Files & Terminal Smart Viewer) for easier
 * reading (iterate-2026-07-23-mission-viewer-scroll-popout).
 *
 * Sibling of the legacy `ArtifactPanel`, which continues to serve scenarios
 * 1/3/4/5 untouched.
 *
 * a11y: role=dialog, Esc closes, focus returns to the node that opened it.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { MissionArtifactBody } from "./MissionArtifactBody";
import { MissionArtifactModal } from "./MissionArtifactModal";

interface Props {
  taskId: string;
  artifact: ArtifactDescriptor;
  onClose: () => void;
}

export function MissionArtifactPanel({ taskId, artifact, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnToRef = useRef<HTMLElement | null>(null);
  const [popoutOpen, setPopoutOpen] = useState(false);
  // Read at Esc-time (capture phase) so the guard never sees a stale value even
  // if Radix flips the modal state mid-dispatch.
  const popoutOpenRef = useRef(popoutOpen);
  popoutOpenRef.current = popoutOpen;

  useEffect(() => {
    returnToRef.current = document.activeElement as HTMLElement | null;
  }, [artifact.kind]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => () => returnToRef.current?.focus?.(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The pop-out modal owns Esc while it is open (Radix closes it on the
      // bubble phase). This is a CAPTURE-phase listener, so it runs FIRST — it
      // sees the modal still open and bows out, so a single Esc never also
      // closes the panel behind it (AC4). When the modal is closed, Esc closes
      // the panel as before.
      if (popoutOpenRef.current) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
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
        <div className="a-tools">
          <button
            type="button"
            className="a-popout"
            onClick={() => setPopoutOpen(true)}
            data-testid="artifact-popout"
            title="Expand to a larger view"
          >
            <ExternalLink size={13} aria-hidden="true" />
            Pop out
          </button>
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
        </div>

        <span className="eyebrow">{artifact.label}</span>
        {/* While the pop-out is open the modal renders the SAME body. Rendering
            it here too would put a document's heading ids (rehype-slug) in the
            DOM twice — duplicate ids that break in-doc anchor nav inside the
            modal (an anchor would resolve to the occluded inline copy). The
            inline panel sits behind the modal overlay anyway, so drop its body
            until the modal closes (external review — duplicate-render). */}
        {popoutOpen ? null : <MissionArtifactBody taskId={taskId} artifact={artifact} />}
      </aside>

      <MissionArtifactModal
        open={popoutOpen}
        onOpenChange={setPopoutOpen}
        taskId={taskId}
        artifact={artifact}
      />
    </>
  );
}
