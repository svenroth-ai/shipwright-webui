/*
 * TriageItemRow — one triage item as a row inside a project lane
 * (iterate-2026-11-12-triage-lanes-rows; reworked by
 * iterate-2026-11-13-triage-rows-round3). The row is its own bar. The title
 * starts at the left edge; on the right sit a fixed, otherwise EMPTY action
 * zone (the buttons appear in it on hover / focus, so the title never
 * reflows) and the meta cluster: round severity number, the copyable id and
 * the age. The explanation (detail, audit checks, source help) and the
 * "pending delivery" state live in the detail dialog, not here. On touch
 * screens, phones and narrow rows the buttons sit under the title instead.
 * Layout lives in triage-rows.css.
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
import { ReturnedBadge } from "./TriageBadgeUI";
import { TriageCardActions } from "./TriageCardActions";
import { TriageIdCopy } from "./TriageIdCopy";
import { PromoteModal } from "./PromoteModal";
import { SeverityNumber } from "./TriageSeverityNumber";
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
        className="triage-row relative block rounded-[10px] border border-white/[0.09] bg-white/[0.055] text-white/95 transition-colors hover:border-white/20 hover:bg-white/10 focus-within:border-white/20 focus-within:bg-white/10"
        data-testid={`triage-item-${item.id}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(NO_OPEN)) return;
          // Dragging across this row's text to select it must not open the dialog.
          const sel = window.getSelection();
          if (sel?.toString() && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) return;
          onOpen();
        }}
      >
        <div className="triage-row-in">
          <div className="triage-row-main flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {item.revisitDue && <ReturnedBadge />}
            {projectLabel && (
              <span className="shrink-0 text-xs text-white/70" data-testid={`triage-item-${item.id}-project`}>
                {projectLabel}
              </span>
            )}
            <h3 className="triage-row-title m-0 min-w-0 flex-1 basis-full text-sm font-medium leading-snug [overflow-wrap:anywhere] md:basis-0">
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
          </div>

          {open ? (
            <div
              className="triage-row-actions"
              data-no-open
              data-testid={`triage-row-actions-${item.id}`}
            >
              <TriageCardActions projectId={projectId} item={item} a={a} snoozing={snoozing} task={task} />
            </div>
          ) : (
            <p
              className="triage-row-note m-0 text-xs text-white/70"
              data-testid={`triage-deferred-item-${item.id}-revisit`}
            >
              {item.revisitAt ? `Parked — returns on ${item.revisitAt}` : "Parked — no revisit date set"}
            </p>
          )}

          <div className="triage-row-meta">
            <SeverityNumber severity={item.severity} />
            <TriageIdCopy id={item.id} />
            <span
              className="triage-row-ts w-[3.4rem] text-right text-xs tabular-nums text-white/60"
              title={item.originalTs}
              data-testid={`triage-item-${item.id}-relative-ts`}
            >
              {formatRelative(item.originalTs)}
            </span>
          </div>

          {open && task && (
            <div className="triage-row-wide">
              <TriageTaskBox itemId={item.id} task={task} />
            </div>
          )}

          {a.error && (
            <div
              className="triage-row-wide rounded border border-[var(--err-line)] bg-err-tint p-2 text-xs text-err"
              data-testid={`triage-card-error-${item.id}`}
            >
              {a.error}
            </div>
          )}
        </div>
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
