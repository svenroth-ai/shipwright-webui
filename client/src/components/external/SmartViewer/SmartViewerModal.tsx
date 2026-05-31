/*
 * SmartViewerModal — centered, viewport-level pop-out of a SmartViewer file
 * preview (iterate-2026-05-31-smartviewer-popout-modal).
 *
 * Replaces the old `window.open("/preview", "_blank")` new-tab pop-out. Reuses
 * the Radix Dialog pattern shared with ContinuePipelineModal / NewIssueModal:
 * a portal-to-body overlay + viewport-centered content, so the expanded view
 * is anchored to the viewport (dimmed full-app backdrop) — NOT to the right
 * pane it was launched from. ESC + backdrop click close via Radix `onOpenChange`.
 *
 * The body renders a fresh <SmartViewer> with `popOut={false}` so the nested
 * preview shows no further pop-out button (no recursion). The /preview route
 * stays as-is for users who still want a standalone browser tab/window.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { FileText, X } from "lucide-react";

import { SmartViewer } from "../SmartViewer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Project-root-relative POSIX path of the file to preview. */
  path: string;
}

export function SmartViewerModal({ open, onOpenChange, projectId, path }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          // The file path in the header doubles as the accessible title; no
          // separate description is needed, so opt out of Radix's warning.
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[90vh] w-[min(1200px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-[var(--color-surface,#ffffff)] shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="smart-viewer-modal"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2.5">
            <FileText
              size={14}
              className="shrink-0 text-[var(--color-accent,#857568)]"
              aria-hidden="true"
            />
            <Dialog.Title
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text,#1a1a1a)]"
              data-testid="smart-viewer-modal-path"
              title={path}
            >
              {path}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="smart-viewer-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <SmartViewer projectId={projectId} path={path} popOut={false} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
