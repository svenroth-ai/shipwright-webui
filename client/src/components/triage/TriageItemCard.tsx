/*
 * TriageItemCard.tsx — one triage item as a solid card
 * (iterate-2026-11-08-triage-page-redesign). Click the title (or the card
 * body) → opens TriageDetailModal. The card carries the actions themselves:
 * the primary one (Fix now, or Start campaign / Go to board on a campaign
 * item), Promote, a Snooze menu and Dismiss, plus a pencil for title and
 * severity. A bundled compliance / phase-quality item lists each audit check
 * on its own line with a "?" help.
 *
 * All triage fields render as plain text — no MarkdownText, no
 * dangerouslySetInnerHTML (XSS mirror of MasterTaskCard's domain chip,
 * ADR-100). The surface is the opaque `--color-surface` token on purpose:
 * a translucent card turns white-on-white under `.on-photo` (recurring
 * defect), so it stays solid.
 */

import { memo } from "react";
import { Loader2, X } from "lucide-react";

import { useSnoozePending } from "../../hooks/useSnoozePending";
import type { TriageItem } from "../../lib/triageApi";
import { parseFindings } from "../../lib/triageFindings";
import { checkHelp, severityHelp, sourceHelp } from "../../lib/triageHelpText";
import { PendingDeliveryBadge, ReturnedBadge, SeverityBadge, SourceBadge } from "./TriageBadgeUI";
import { PromoteModal } from "./PromoteModal";
import { TriageHelp } from "./TriageHelp";
import { TriageQuickEdit } from "./TriageQuickEdit";
import { TriageSnoozeMenu } from "./TriageSnoozeMenu";
import { useTriageCardActions } from "./useTriageCardActions";
import type { FixNowIntent } from "./fixNowIntent";

interface TriageItemCardProps {
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

export const PRIMARY_BTN =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed";
export const SECONDARY_BTN =
  "inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed";

function TriageItemCardImpl({
  projectId,
  item,
  projectLabel,
  onOpen,
  onFixNow,
  onNavigateToBoard,
}: TriageItemCardProps) {
  const a = useTriageCardActions({ projectId, item, onFixNow, onNavigateToBoard });
  const findings = item.source === "compliance" || item.source === "phaseQuality"
    ? parseFindings(item.detail)
    : [];
  const open = item.status === "triage";
  const snoozing = useSnoozePending(projectId);

  return (
    <>
    <article
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-card-hover)] max-md:px-3"
      data-testid={`triage-item-${item.id}`}
      aria-label={item.title}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
        onOpen();
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SourceBadge source={item.source} />
        <TriageHelp help={sourceHelp(item.source)} subject={`source-${item.source}`} />
        <SeverityBadge severity={item.severity} />
        <TriageHelp help={severityHelp(item.severity)} subject={`severity-${item.severity}`} />
        {item.pendingDelivery && <PendingDeliveryBadge />}
        {item.revisitDue && <ReturnedBadge />}
        {projectLabel && (
          <span className="text-[11px] text-[var(--color-muted)]" data-testid={`triage-item-${item.id}-project`}>
            {projectLabel}
          </span>
        )}
        <span className="font-mono text-[11px] text-[var(--color-muted)]">{item.id}</span>
        <span
          className="text-[11px] text-[var(--color-muted)] min-[1500px]:ml-auto"
          title={item.originalTs}
          data-testid={`triage-item-${item.id}-relative-ts`}
        >
          {formatRelative(item.originalTs)}
        </span>
      </div>

      <h3 className="text-sm font-medium leading-snug text-[var(--color-text)]">
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

      {findings.length > 0 ? (
        <ul className="m-0 grid list-none gap-1 p-0" data-testid={`triage-item-${item.id}-findings`}>
          {findings.map((f, i) => (
            <li
              key={`${f.code}-${i}`}
              className="flex items-center gap-2 rounded-md bg-[var(--color-muted-bg)] px-2 py-1 text-[13px] text-[var(--color-text)]"
            >
              <code className="shrink-0 rounded bg-[var(--color-surface)] px-1.5 py-px text-[11px]">{f.code}</code>
              <span className="min-w-0 flex-1 truncate" title={f.detail ? `${f.title} — ${f.detail}` : f.title}>
                {f.title}
              </span>
              <TriageHelp help={checkHelp(f.code, f.title)} subject={`check-${f.code}`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-snug text-[var(--color-text)]">
          {item.detail}
        </p>
      )}

      {item.dedupKey && (
        <p className="font-mono text-[10px] text-[var(--color-muted)]">dedup: {item.dedupKey}</p>
      )}

      {open ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="mr-auto">
            <TriageQuickEdit projectId={projectId} item={item} />
          </span>
          {a.showCampaignCta && a.campaignStatus === "active" ? (
            <button type="button" onClick={a.goToBoard} className={PRIMARY_BTN} data-testid={`triage-card-go-to-board-${item.id}`}>
              Go to board →
            </button>
          ) : a.showCampaignCta ? (
            <button
              type="button"
              onClick={() => void a.startCampaign()}
              disabled={a.startingCampaign || a.writeDisabled}
              title={a.writeDisabled ? a.writeDisabledReason : undefined}
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
            title={a.writeDisabled ? a.writeDisabledReason : undefined}
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
          <button
            type="button"
            onClick={() => void a.dismiss()}
            disabled={a.writeDisabled || a.dismissing || snoozing}
            title={a.writeDisabled ? a.writeDisabledReason : "Dismiss"}
            aria-label="Dismiss"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] disabled:opacity-50"
            data-testid={`triage-card-dismiss-${item.id}`}
          >
            {a.dismissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X size={15} />}
          </button>
        </div>
      ) : (
        <p
          className="text-[11px] text-[var(--color-muted)]"
          data-testid={`triage-deferred-item-${item.id}-revisit`}
        >
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
    </article>
      {/* Sibling of the article, not a child: a portaled dialog bubbles React
          events up the React tree, and the article's click opens the detail. */}
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

export const TriageItemCard = memo(TriageItemCardImpl);
