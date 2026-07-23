/*
 * MissionArtifactModal — a centered, viewport-level POP-OUT of the Mission
 * artifact panel (iterate-2026-07-23-mission-viewer-scroll-popout).
 *
 * The same idea as `SmartViewer/SmartViewerModal`, and the same Radix Dialog
 * pattern (portal-to-body overlay + viewport-centered content): the expanded
 * view is anchored to the VIEWPORT, not to the 400px right card it launched
 * from, so a long Requirement / Spec / Tests body is readable at width. ESC +
 * backdrop click + the close button all dismiss via `onOpenChange`.
 *
 * It CANNOT reuse SmartViewerModal: that renders a `SmartViewer` keyed on a file
 * PATH, but a Mission artifact is fetched by an opaque signed document id and
 * several kinds are not files at all (§5.2 / FR-01.66 G — "the client never
 * constructs a /file?path="). Instead it re-renders the very same
 * `MissionArtifactBody` the inline panel uses, so the per-kind detail renderers
 * are shared, not duplicated.
 *
 * The detail styles are `.artifact`-scoped, so the body is wrapped in
 * `.artifact.is-popout` — a modifier that neutralises the base slide-over's
 * position/width/overflow (this render lives OUTSIDE `.on-photo`, in the portal,
 * so only the base `.artifact` rules would otherwise apply). The scroll body is
 * the shared `<ModalScrollBody>` (DO-NOT #24 — never hand-roll a dialog scroller).
 */

import * as Dialog from "@radix-ui/react-dialog";
import { FileText, X } from "lucide-react";

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { ModalScrollBody } from "../../common/ModalScrollBody";
import { MissionArtifactBody } from "./MissionArtifactBody";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  artifact: ArtifactDescriptor;
}

export function MissionArtifactModal({ open, onOpenChange, taskId, artifact }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          // The artifact label in the header doubles as the accessible title; no
          // separate description is needed, so opt out of Radix's warning.
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(1000px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="mission-artifact-modal"
          data-node={artifact.kind}
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <FileText
              size={14}
              className="shrink-0 text-[var(--color-accent,#857568)]"
              aria-hidden="true"
            />
            <Dialog.Title
              className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text,#1a1a1a)]"
              data-testid="mission-artifact-modal-label"
              title={artifact.label}
            >
              {artifact.label}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="mission-artifact-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <ModalScrollBody
            className="max-h-[calc(90vh-52px)]"
            data-testid="mission-artifact-modal-body"
          >
            <div className="artifact is-popout">
              <MissionArtifactBody taskId={taskId} artifact={artifact} />
            </div>
          </ModalScrollBody>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
