/*
 * TriageCardActions — the action buttons of an OPEN triage row
 * (iterate-2026-11-08-triage-page-redesign, extended by
 * iterate-2026-11-09-triage-fixnow-task; shown in a Triage row since
 * iterate-2026-11-12-triage-lanes-rows). Without a linked task: main action
 * (Fix now / Start campaign / Go to board), Promote, Snooze, a Dismiss cross
 * that asks for an optional reason first, and the edit pencil last. With a
 * linked Fix-now task: Resolve (same reason popup), the cross and the pencil.
 */

import { Loader2, X } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import type { TriageItem } from "../../lib/triageApi";
import { TriageDismissPopover } from "./TriageDismissPopover";
import { TriageQuickEdit } from "./TriageQuickEdit";
import { TriageSnoozeMenu } from "./TriageSnoozeMenu";
import type { useTriageCardActions } from "./useTriageCardActions";

export const PRIMARY_BTN =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed";
export const SECONDARY_BTN =
  "inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed";

interface Props {
  projectId: string;
  item: TriageItem;
  a: ReturnType<typeof useTriageCardActions>;
  snoozing: boolean;
  /** The item's live Fix-now task, when it has one. */
  task?: ExternalTask;
}

export function TriageCardActions({ projectId, item, a, snoozing, task }: Props) {
  const blocked = a.writeDisabled || a.dismissing || snoozing;
  const blockedTitle = a.writeDisabled ? a.writeDisabledReason : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {task ? (
          <TriageDismissPopover
            itemId={item.id}
            label="Resolve"
            defaultReason={`Resolved via task: ${task.title}`.slice(0, 500)}
            pending={a.dismissing}
            onConfirm={a.dismiss}
            trigger={
              <button
                type="button"
                disabled={blocked}
                title={blockedTitle}
                className={SECONDARY_BTN}
                data-testid={`triage-card-resolve-${item.id}`}
              >
                Resolve
              </button>
            }
          />
        ) : (
          <>
            {a.showCampaignCta && a.campaignStatus === "active" ? (
              <button type="button" onClick={a.goToBoard} className={PRIMARY_BTN} data-testid={`triage-card-go-to-board-${item.id}`}>
                Go to board →
              </button>
            ) : a.showCampaignCta ? (
              <button
                type="button"
                onClick={() => void a.startCampaign()}
                disabled={a.startingCampaign || a.writeDisabled}
                title={blockedTitle}
                className={PRIMARY_BTN}
                data-testid={`triage-card-start-campaign-${item.id}`}
              >
                {a.startingCampaign && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Start campaign
              </button>
            ) : (
              <button
                type="button"
                onClick={a.fixNow}
                disabled={a.fixNowLoading}
                className={PRIMARY_BTN}
                data-testid={`triage-card-fix-now-${item.id}`}
              >
                {a.fixNowLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Fix now
              </button>
            )}
            <button
              type="button"
              onClick={() => a.setPromoteOpen(true)}
              disabled={a.writeDisabled}
              title={blockedTitle}
              className={SECONDARY_BTN}
              data-testid={`triage-card-promote-${item.id}`}
            >
              Promote
            </button>
            <TriageSnoozeMenu
              projectId={projectId}
              itemId={item.id}
              disabled={a.writeDisabled || a.dismissing}
              disabledReason={a.writeDisabledReason}
              buttonClassName={SECONDARY_BTN}
            />
          </>
        )}
        <TriageDismissPopover
          itemId={item.id}
          label="Dismiss"
          pending={a.dismissing}
          onConfirm={a.dismiss}
          trigger={
            <button
              type="button"
              disabled={blocked}
              title={a.writeDisabled ? a.writeDisabledReason : "Dismiss"}
              aria-label="Dismiss"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-50"
              data-testid={`triage-card-dismiss-${item.id}`}
            >
              {a.dismissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X size={15} />}
            </button>
          }
        />
        <TriageQuickEdit projectId={projectId} item={item} iconOnly />
      </div>
    </div>
  );
}
