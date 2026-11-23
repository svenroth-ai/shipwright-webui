/*
 * SkippedEntriesNotice — one status line when the proposals file holds entries the parser dropped
 * (ambiguous fence, damaged or non-canonical entry, structural injection, dangling fence). Count and
 * lead ids only: nothing of a skipped entry is ever shown.
 */
import { AlertCircle } from "lucide-react";

import type { SkippedEntries } from "../../lib/orgDecisionsApi";

export function SkippedEntriesNotice({ skipped }: { skipped: SkippedEntries | undefined }) {
  if (!skipped || skipped.count === 0) return null;
  const n = skipped.count;
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-1 text-[11px]"
      style={{ color: "var(--color-muted, #6b7280)" }}
      data-testid="org-decisions-proposed-skipped"
    >
      <AlertCircle size={12} aria-hidden="true" />
      {n} {n === 1 ? "entry" : "entries"} could not be read and {n === 1 ? "was" : "were"} skipped
      {skipped.leadIds.length > 0 ? ` (lead: ${skipped.leadIds.join(", ")})` : ""}.
    </div>
  );
}
