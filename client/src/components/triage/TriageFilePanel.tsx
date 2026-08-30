import { FileText, X } from "lucide-react";
import { SmartViewer } from "../external/SmartViewer";

interface Props {
  projectId: string;
  path: string;
  onClose: () => void;
}

/**
 * Right-side file viewer opened from a triage file mention/evidence link
 * (iterate-2026-08-29-compliance-file-viewer). Deliberately NOT its own
 * Dialog/overlay — it nests inside TriageDetailModal's existing
 * Dialog.Content, appearing beside the triage details rather than stacking
 * another backdrop on top of them.
 *
 * The outer container needs `min-h-0` + `min-w-0` (iterate-2026-08-30
 * follow-up): as a flex item it otherwise grows to its content's natural
 * size on either axis instead of shrinking to the space Dialog.Content
 * allotted it, which then clips the overflow with its own `overflow-hidden`
 * instead of a scrollbar. This alone is NOT sufficient, though: percentage
 * heights (`h-full`) only resolve against an ancestor with a genuinely
 * DEFINITE `height` (not `max-height`, and not a size merely produced by
 * flex-grow) — Dialog.Content therefore switches from `max-h-[85vh]` to a
 * real `h-[85vh]` while a file is open (see TriageDetailModal.tsx), giving
 * this panel's own `h-full` something real to resolve against, which then
 * cascades correctly down through SmartViewer and CodeRenderer.
 */
export function TriageFilePanel({ projectId, path, onClose }: Props) {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--color-border)]"
      data-testid="triage-file-panel"
      role="region"
      aria-label={`File preview: ${path}`}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <FileText size={13} className="shrink-0 text-[var(--color-accent,#857568)]" aria-hidden="true" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px]"
          title={path}
          data-testid="triage-file-panel-path"
        >
          {path}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file viewer"
          data-testid="triage-file-panel-close"
          className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)]"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SmartViewer projectId={projectId} path={path} popOut={false} />
      </div>
    </div>
  );
}
