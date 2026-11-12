/*
 * TriageItemRow — one triage item as a row inside a project lane
 * (iterate-2026-11-12-triage-lanes-rows; replaces the card grid). Left to
 * right: severity, the copyable id, the full title. The explanation (detail,
 * audit checks, source help) lives in the detail dialog, not here. The action
 * buttons (Fix now, Promote, Snooze, Dismiss, pencil) appear on hover / focus
 * as an overlay at the row's right edge (the title re-wraps to make room instead of being covered; only on wide rows with a mouse); on touch
 * screens and phones they sit under the title instead.
 *
 * Text is plain (no markdown, no dangerouslySetInnerHTML — ADR-100). The lane
 * is dark glass (same recipe as the task board), so text uses explicit white
 * tints rather than `--body` / `--muted`, which flip under `.on-photo`.
 */

import { memo } from "react";

import { useSnoozePending } from "../../hooks/useSnoozePending";
import { useTriageTaskLinks } from "../../hooks/useTriageTaskLinks";
import type { TriageItem } from "../../lib/triageApi";
import { taskLinkKey } from "../../lib/triageTaskLinks";
import { PendingDeliveryBadge, ReturnedBadge, SeverityBadge } from "./TriageBadgeUI";
import { TriageCardActions } from "./TriageCardActions";
import { TriageIdCopy } from "./TriageIdCopy";
import { PromoteModal } from "./PromoteModal";
import { TriageTaskBox } from "./TriageTaskBox";
import { useTriageCardActions } from "./useTriageCardActions";
import type { FixNowIntent } from "./fixNowIntent";

interface Props {
  projectId: string;
  item: TriageItem;
  /** Shown when the list is not grouped by project and several projects exist. */
  projectLabel?: string;
  onOpen: () => void;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}

/** Best-effort relative time of the original append; raw ISO on parse failure. */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.floor((Date.now() - t) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

/** Clicks on interactive bits and on the selectable id must not open the dialog. */
const NO_OPEN = "button,a,input,select,textarea,label,[data-no-open]";

function TriageItemRowImpl({
  projectId,
  item,
  projectLabel,
  onOpen,
  onFixNow,
  onNavigateToBoard,
}: Props) {
  const a = useTriageCardActions({ projectId, item, onFixNow, onNavigateToBoard });
  const open = item.status === "triage";
  const snoozing = useSnoozePending(projectId);
  const task = useTriageTaskLinks().get(taskLinkKey(projectId, item.id));

  return (
    <>
      <li
        className="triage-row relative flex flex-col gap-1.5 border-t border-white/10 px-3.5 py-2.5 text-white/95 first:border-t-0 hover:bg-white/[0.06] focus-within:bg-white/[0.06]"
        data-testid={`triage-item-${item.id}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(NO_OPEN)) return;
          // Dragging across this row's text to select it must not open the dialog.
          const sel = window.getSelection();
          if (sel?.toString() && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) return;
          onOpen();
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 md:flex-nowrap">
          <span className="flex shrink-0 items-center gap-2">
            <SeverityBadge severity={item.severity} />
            <TriageIdCopy id={item.id} />
          </span>
          {item.pendingDelivery && <PendingDeliveryBadge />}
          {item.revisitDue && <ReturnedBadge />}
          {projectLabel && (
            <span className="shrink-0 text-xs text-white/70" data-testid={`triage-item-${item.id}-project`}>
              {projectLabel}
            </span>
          )}
          <h3 className="triage-row-title m-0 min-w-0 basis-full text-sm font-medium leading-snug [overflow-wrap:anywhere] md:basis-0 md:flex-1">
            <button
              type="button"
              onClick={onOpen}
              data-nav-item
              data-testid={`triage-item-${item.id}-title`}
              className="text-left hover:underline focus-visible:underline"
            >
              {item.title}
            </button>
          </h3>
          <span
            className="triage-row-ts shrink-0 text-xs tabular-nums text-white/60"
            title={item.originalTs}
            data-testid={`triage-item-${item.id}-relative-ts`}
          >
            {formatRelative(item.originalTs)}
          </span>
        </div>

        {open && task && <TriageTaskBox itemId={item.id} task={task} />}

        {open ? (
          <div
            className="triage-row-actions"
            data-no-open
            data-testid={`triage-row-actions-${item.id}`}
          >
            <TriageCardActions projectId={projectId} item={item} a={a} snoozing={snoozing} task={task} />
          </div>
        ) : (
          <p className="m-0 text-xs text-white/70" data-testid={`triage-deferred-item-${item.id}-revisit`}>
            {item.revisitAt ? `Parked — returns on ${item.revisitAt}` : "Parked — no revisit date set"}
          </p>
        )}

        {a.error && (
          <div
            className="rounded border border-[var(--err-line)] bg-err-tint p-2 text-xs text-err"
            data-testid={`triage-card-error-${item.id}`}
          >
            {a.error}
          </div>
        )}
      </li>
      {/* Sibling of the row, not a child: a portaled dialog bubbles React
          events up the React tree, and the row's click opens the detail. */}
      {a.promoteOpen && (
        <PromoteModal
          open={a.promoteOpen}
          onOpenChange={a.setPromoteOpen}
          projectId={projectId}
          item={item}
          writeDisabled={a.writeDisabled}
          writeDisabledReason={a.writeDisabledReason}
          onPromoted={() => a.setPromoteOpen(false)}
        />
      )}
    </>
  );
}

export const TriageItemRow = memo(TriageItemRowImpl);
