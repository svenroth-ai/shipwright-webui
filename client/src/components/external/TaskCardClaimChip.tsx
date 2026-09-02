/*
 * ClaimChip — visible claim indicator on the TaskCard meta row (FR-04.22,
 * iterate-2026-09-02-claim-chip-filter).
 *
 * Section 5.2 of the lead-model spec settles the marker: "ein Anspruch
 * veraendert `state` nicht... Sichtbar ist der Anspruch an `claimedBy` /
 * `claimToken`, nicht am Zustand." leadwright's `claimTask` still sets
 * `state = "active"` today (lib/lead-task-claim.ts:155), but section 5.2
 * says that line falls without replacement in a later iterate (L11) — this
 * chip is keyed EXCLUSIVELY off `claimedBy` / `claimedAt`, never `state`,
 * so it stays correct across that transition instead of breaking silently
 * the day it lands. Renders nothing when the task is unclaimed.
 */
import { User } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import { formatRelativeTime } from "../../lib/formatTime";

export function ClaimChip({ task }: { task: ExternalTask }) {
  if (!task.claimedBy) return null;
  const since = task.claimedAt ? formatRelativeTime(task.claimedAt) : null;
  return (
    <span
      data-testid={`task-card-claim-${task.taskId}`}
      title={since ? `Claimed by ${task.claimedBy}, ${since}` : `Claimed by ${task.claimedBy}`}
      className="inline-flex items-center gap-1 rounded-[10px] bg-[var(--color-muted-bg)] px-2 py-[2px] text-[11px] font-medium text-[var(--color-muted)]"
    >
      <User size={11} aria-hidden="true" />
      <span className="max-w-[110px] truncate">{task.claimedBy}</span>
      {since && (
        <span data-testid={`task-card-claim-since-${task.taskId}`} className="opacity-75">
          · {since}
        </span>
      )}
    </span>
  );
}
