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
 */
export function TriageFilePanel({ projectId, path, onClose }: Props) {
  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col border-l border-[var(--color-border)]"
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
