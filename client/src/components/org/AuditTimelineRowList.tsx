/*
 * AuditTimelineRowList — renders the merged rows for `AuditTimelineModal`
 * (loading / empty / per-lead-fetch-error / rows / Load-more / ceiling
 * notice). Split out purely to keep the modal file under the 300-line
 * guideline.
 */

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import type { AuditLogEntry } from "../../lib/orgApi";
import { formatRelativeTime } from "../../lib/formatTime";
import { auditKindLabel } from "../../lib/auditKindLabels";
import { MAX_WINDOW, type AuditTimelineRow } from "../../lib/auditTimelineMerge";

function rowLabel(entry: AuditLogEntry): string {
  if (!entry.parsed) return "Unparseable entry";
  const kind = entry.parsed.kind;
  return typeof kind === "string" ? auditKindLabel(kind) : "Unrecognized entry";
}

function rowSummary(entry: AuditLogEntry): string | undefined {
  const summary = entry.parsed?.summary;
  return typeof summary === "string" ? summary : undefined;
}

interface Props {
  rows: AuditTimelineRow[];
  isLoading: boolean;
  isWindowLoading: boolean;
  failedLeadNames: string[];
  leadName: (leadId: string) => string;
  hasMore: boolean;
  atCeiling: boolean;
  onLoadMore: () => void;
}

export function AuditTimelineRowList({
  rows,
  isLoading,
  isWindowLoading,
  failedLeadNames,
  leadName,
  hasMore,
  atCeiling,
  onLoadMore,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {isLoading && rows.length === 0 && (
        <div
          className="flex h-full items-center justify-center text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="org-audit-timeline-loading"
        >
          <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && rows.length === 0 && failedLeadNames.length === 0 && (
        <div
          className="flex h-full items-center justify-center text-[12px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid="org-audit-timeline-empty"
        >
          No activity in this window.
        </div>
      )}
      {failedLeadNames.length > 0 && (
        <div
          className="mb-2 flex items-center gap-2 rounded-[6px] p-2 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          role="alert"
          data-testid="org-audit-timeline-error"
        >
          <AlertCircle size={14} aria-hidden="true" />
          <span>Couldn't load activity for: {failedLeadNames.join(", ")}</span>
        </div>
      )}
      {rows.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="org-audit-timeline-rows">
          {rows.map((row) => {
            // Keyed by (leadId, physical fetch index), not raw content —
            // two identical JSONL lines for the same lead would otherwise
            // collide on a content-based key (external-review finding).
            const key = `${row.leadId}|${row.index}`;
            const isOpen = expandedKey === key;
            const iso = row.entry.parsed?.ts;
            return (
              <div key={key} className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] p-2">
                <button
                  type="button"
                  onClick={() => setExpandedKey(isOpen ? null : key)}
                  data-testid="org-audit-timeline-row"
                  className="flex w-full items-center gap-2 text-left text-[12px]"
                >
                  <span
                    className="w-16 shrink-0 text-[var(--color-muted,#6b7280)]"
                    title={typeof iso === "string" ? iso : undefined}
                  >
                    {typeof iso === "string" ? formatRelativeTime(iso) : "unknown time"}
                  </span>
                  <span className="w-28 shrink-0 truncate font-medium">{leadName(row.leadId)}</span>
                  <span className="w-40 shrink-0 truncate">{rowLabel(row.entry)}</span>
                  <span className="flex-1 truncate text-[var(--color-muted,#6b7280)]">
                    {rowSummary(row.entry) ?? ""}
                  </span>
                </button>
                {isOpen && (
                  <pre className="mt-2 whitespace-pre-wrap break-all rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)]/40 p-2 text-[11px]">
                    {row.entry.parsed ? JSON.stringify(row.entry.parsed, null, 2) : row.entry.raw}
                  </pre>
                )}
              </div>
            );
          })}
          {isWindowLoading ? (
            <span
              className="mt-1 flex items-center justify-center gap-2 self-center py-2 text-[11px]"
              style={{ color: "var(--color-muted, #6b7280)" }}
              data-testid="org-audit-timeline-window-loading"
            >
              <Loader2 size={12} className="animate-spin" /> Loading…
            </span>
          ) : (
            <>
              {atCeiling && (
                <span
                  className="self-center py-2 text-[11px]"
                  style={{ color: "var(--color-muted, #6b7280)" }}
                  data-testid="org-audit-timeline-ceiling"
                >
                  Showing the most recent {MAX_WINDOW} combined entries per lead — narrow leads or the
                  time window to see more.
                </span>
              )}
              {!atCeiling && hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  data-testid="org-audit-timeline-load-more"
                  className="mt-1 self-center rounded-[6px] px-3 py-1.5 text-[12px] font-medium text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)]"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
