/*
 * PathStrip — SmartViewer breadcrumb strip shown below the tab bar.
 * Extracted from SmartViewer.tsx (iterate-2026-05-30-smartviewer-render-ux)
 * to keep that file under the 300-LOC limit. Renders the file's folder
 * segments separated by chevrons, plus a size badge once a text file has
 * loaded.
 */

import { ChevronRight, Folder } from "lucide-react";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function PathStrip({ path, size }: { path: string; size: number | null }) {
  const segments = path.split("/").filter(Boolean);
  return (
    <div
      className="flex min-h-[26px] items-center gap-1.5 border-b border-[var(--color-border,#e0dbd4)] px-4 py-1 font-mono text-[11px] text-[var(--color-muted,#6b7280)]"
      data-testid="smart-viewer-path-strip"
    >
      <Folder
        size={11}
        className="shrink-0 text-[var(--color-accent,#857568)]"
        aria-hidden="true"
      />
      {segments.map((seg, i) => (
        <span key={`${seg}-${i}`} className="inline-flex items-center gap-1.5">
          <span className="truncate">{seg}</span>
          {i < segments.length - 1 && (
            <ChevronRight size={10} aria-hidden="true" className="opacity-50" />
          )}
        </span>
      ))}
      {size !== null && (
        <span
          className="ml-2 inline-flex items-center rounded-[3px] bg-[var(--color-muted-bg,#ede8e1)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--color-muted,#6b7280)]"
          data-testid="smart-viewer-size-badge"
        >
          {formatBytes(size)}
        </span>
      )}
    </div>
  );
}
