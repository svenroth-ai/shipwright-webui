/*
 * TriageItemCard.tsx — one triage item as a solid card
 * (iterate-2026-11-08-triage-page-redesign). Click the title (or the card
 * body) → opens TriageDetailModal. The card carries the actions themselves:
 * (see TriageCardActions): the primary one (Fix now, or Start campaign / Go
 * to board on a campaign item), Promote, a Snooze menu and Dismiss, plus a
 * pencil for title and severity. After Fix now the card shows its task
 * (TriageTaskBox) and offers Resolve. A bundled compliance / phase-quality item lists each audit check
 * on its own line with a "?" help.
 *
 * All triage fields render as plain text — no MarkdownText, no
 * dangerouslySetInnerHTML (XSS mirror of MasterTaskCard's domain chip,
 * ADR-100). The surface is the opaque `--surface-form` token (same grey as the New Task dialog) on purpose:
 * a translucent card turns white-on-white under `.on-photo` (recurring
 * defect), so it stays solid. Because the article is NOT on the on-photo reset
 * whitelist, `--body` / `--muted` resolve to near-white inside it. Use the legacy
 * `--color-text` (never flipped) for secondary text here, never those tokens.
 */

import { memo } from "react";
import { useSnoozePending } from "../../hooks/useSnoozePending";
import { useTriageTaskLinks } from "../../hooks/useTriageTaskLinks";
import type { TriageItem } from "../../lib/triageApi";
import { taskLinkKey } from "../../lib/triageTaskLinks";
import { parseFindings } from "../../lib/triageFindings";
import { checkHelp } from "../../lib/triageHelpText";
import { PromoteModal } from "./PromoteModal";
import { TriageHelp } from "./TriageHelp";
import { TriagePills } from "./TriagePills";
import { TriageCardActions } from "./TriageCardActions";
import { TriageTaskBox } from "./TriageTaskBox";
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

/** A card shows at most this many audit checks; the rest are one click away in the detail dialog. */
const MAX_CARD_FINDINGS = 3;

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
  const task = useTriageTaskLinks().get(taskLinkKey(projectId, item.id));

  return (
    <>
    <article
      className="flex h-full min-w-0 flex-col gap-2.5 rounded-[var(--radius-card)] border border-[var(--surface-form-divider,#c3b8ae)] bg-[var(--surface-form,#edeae7)] px-4 py-3.5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-card-hover)] max-md:px-3"
      data-testid={`triage-item-${item.id}`}
      aria-label={item.title}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
        onOpen();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <TriagePills item={item} projectId={projectId} projectLabel={projectLabel} />
        <span className="flex items-center gap-2 text-xs text-[var(--color-text)]">
          <span className="font-mono">{item.id}</span>
          <span title={item.originalTs} data-testid={`triage-item-${item.id}-relative-ts`}>
            {formatRelative(item.originalTs)}
          </span>
        </span>
      </div>

      <h3 className="line-clamp-2 min-h-[2.75em] text-[15px] font-semibold leading-snug text-[var(--color-text)] [overflow-wrap:anywhere]">
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
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0" data-testid={`triage-item-${item.id}-findings`}>
          {findings.slice(0, MAX_CARD_FINDINGS).map((f, i) => (
            <li
              key={`${f.code}-${i}`}
              className="flex items-center gap-2 rounded-md border border-[var(--surface-form-divider,#c3b8ae)] bg-white px-2 py-1 text-[13px] text-[var(--color-text)]"
            >
              <code className="shrink-0 rounded bg-[var(--surface-form,#edeae7)] px-1.5 py-px text-xs">{f.code}</code>
              <span className="min-w-0 flex-1 truncate" title={f.detail ? `${f.title} — ${f.detail}` : f.title}>
                {f.title}
              </span>
              <TriageHelp help={checkHelp(f.code, f.title)} subject={`check-${f.code}`} />
            </li>
          ))}
          {findings.length > MAX_CARD_FINDINGS && (
            <li className="px-1 text-xs text-[var(--color-text)]" data-testid={`triage-item-${item.id}-findings-more`}>
              +{findings.length - MAX_CARD_FINDINGS} more — open the card for all checks
            </li>
          )}
        </ul>
      ) : (
        <p className="line-clamp-3 min-h-[calc(3*1.375em+14px)] rounded-md border border-[var(--surface-form-divider,#c3b8ae)] bg-white px-2.5 py-1.5 text-[13px] leading-snug text-[var(--color-text)] [overflow-wrap:anywhere]">
          {item.detail}
        </p>
      )}

      {open && task && <TriageTaskBox itemId={item.id} task={task} />}

      {open ? (
        <TriageCardActions projectId={projectId} item={item} a={a} snoozing={snoozing} task={task} />
      ) : (
        <p
          className="mt-auto text-xs text-[var(--color-text)]"
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
