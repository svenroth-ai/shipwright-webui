/*
 * TriageDetailModal.tsx — full detail + action buttons (Promote/Dismiss/Snooze).
 *
 * Promote opens the dedicated PromoteModal (form fields). Dismiss + Snooze
 * are simpler — single optional reason input.
 *
 * iterate-2026-05-21-triage-fix-now-and-phase-slash — the **Fix now**
 * CTA semantics changed. Previously (iterate-2026-05-20) it copied the
 * producer-generated `launchPayload` to the clipboard and showed a
 * transient confirmation. After this iterate it builds a `FixNowIntent`
 * via `fixNowIntent.buildFixNowIntent` and bubbles it to the parent via
 * `onFixNow`. The parent (TriagePage) owns the NewIssueModal mount —
 * mounting it inside TriageDetailModal would unmount when this dialog
 * closes on `onOpenChange(false)`, killing the modal before it could
 * render. `LaunchPayloadBlock` still renders informational payload
 * text; the legacy clipboard-copy path is removed.
 */

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";

import type { TriageItem } from "../../lib/triageApi";
import {
  useDismissTriageItem,
  useSnoozeTriageItem,
} from "../../hooks/useTriage";
import { useProjectActions } from "../../hooks/useProjectActions";
import { SeverityBadge, SourceBadge, StatusBadge } from "./TriageBadgeUI";
import { LaunchPayloadBlock } from "./LaunchPayloadBlock";
import { PromoteModal } from "./PromoteModal";
import { buildFixNowIntent, type FixNowIntent } from "./fixNowIntent";

interface TriageDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  item: TriageItem;
  onActionComplete?: (kind: "promoted" | "dismissed" | "snoozed") => void;
  /**
   * iterate-2026-05-21 — invoked when the operator clicks Fix-now AND
   * the resolver returns an actionable intent. The parent owns the
   * NewIssueModal mount (lifecycle reasons — see file header). When
   * `onFixNow` is omitted (legacy callsites), the Fix-now button still
   * renders but clicks surface the "no-handler" message inline.
   */
  onFixNow?: (intent: FixNowIntent) => void;
}

export function TriageDetailModal({
  open,
  onOpenChange,
  projectId,
  item,
  onActionComplete,
  onFixNow,
}: TriageDetailModalProps) {
  const dismiss = useDismissTriageItem(projectId);
  const snooze = useSnoozeTriageItem(projectId);
  const projectActions = useProjectActions(projectId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [fixNowFailure, setFixNowFailure] = useState<string | null>(null);

  // Reset the inline failure surface whenever the displayed item or
  // open-state changes — a stale failure message from a previous click
  // should not bleed onto the next item / re-open.
  useEffect(() => {
    setFixNowFailure(null);
  }, [item.id, open]);

  const onFixNowClick = () => {
    setFixNowFailure(null);
    if (!onFixNow) {
      setFixNowFailure("Fix-now handler not wired on this page.");
      return;
    }
    const result = buildFixNowIntent(item, projectActions.data, projectId);
    if (result.kind === "failed") {
      setFixNowFailure(result.message);
      return;
    }
    // Hand off to the parent BEFORE closing — the parent reads the
    // intent + sets its own NewIssueModal state. The close then unmounts
    // this dialog cleanly without affecting the parent-owned modal.
    onFixNow(result.intent);
    onOpenChange(false);
  };

  const onDismiss = async () => {
    setError(null);
    const result = await dismiss.mutateAsync({
      triageId: item.id,
      reason: reason.trim() || null,
    });
    if (!result.ok) {
      const body = result.body as { error?: string; message?: string };
      setError(
        body.message || `Dismiss failed (${result.status}): ${body.error}`,
      );
      return;
    }
    onActionComplete?.("dismissed");
    onOpenChange(false);
  };

  const onSnooze = async () => {
    setError(null);
    const result = await snooze.mutateAsync({
      triageId: item.id,
      reason: reason.trim() || null,
    });
    if (!result.ok) {
      const body = result.body as { error?: string; message?: string };
      setError(
        body.message || `Snooze failed (${result.status}): ${body.error}`,
      );
      return;
    }
    onActionComplete?.("snoozed");
    onOpenChange(false);
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-40" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[640px] max-w-[90vw] max-h-[85vh] overflow-y-auto bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
            data-testid="triage-detail-modal"
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <Dialog.Title className="text-lg font-semibold">
                    {item.title}
                  </Dialog.Title>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <SourceBadge source={item.source} />
                    <SeverityBadge severity={item.severity} />
                    <StatusBadge status={item.status} />
                    <code className="text-[11px] text-stone-500">{item.id}</code>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] transition-colors"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </Dialog.Close>
              </div>

              <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs mb-4">
                <div>
                  <dt className="text-stone-500">Suggested priority</dt>
                  <dd className="font-mono">{item.suggestedPriority}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Suggested domain</dt>
                  <dd>{item.suggestedDomain}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Kind</dt>
                  <dd>{item.kind}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Original ts</dt>
                  <dd className="font-mono text-[10px]">{item.originalTs}</dd>
                </div>
                {item.dedupKey && (
                  <div className="col-span-2">
                    <dt className="text-stone-500">Dedup key</dt>
                    <dd className="font-mono text-[10px] break-all">
                      {item.dedupKey}
                    </dd>
                  </div>
                )}
                {item.evidencePath && (
                  <div className="col-span-2">
                    <dt className="text-stone-500">Evidence</dt>
                    <dd className="font-mono text-[10px] break-all">
                      {item.evidencePath}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="border-t border-stone-200 pt-4">
                <h4 className="text-xs font-semibold text-stone-700 uppercase mb-2">
                  Detail
                </h4>
                <p
                  className="text-sm text-stone-800 whitespace-pre-wrap"
                  data-testid="triage-detail-body"
                >
                  {item.detail}
                </p>
              </div>

              <LaunchPayloadBlock item={item} />

              {item.status === "triage" && (
                <div className="border-t border-stone-200 pt-4 mt-4">
                  <label className="block">
                    <span className="text-xs font-medium text-stone-700">
                      Reason (optional, applies to Dismiss / Snooze)
                    </span>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm border border-stone-300 rounded"
                      placeholder="out of scope this sprint"
                      data-testid="triage-action-reason"
                    />
                  </label>
                  {error && (
                    <div
                      className="mt-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded"
                      data-testid="triage-action-error"
                    >
                      {error}
                    </div>
                  )}
                  {fixNowFailure && (
                    <div
                      className="mt-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded"
                      data-testid="triage-fix-now-failure"
                    >
                      {fixNowFailure}
                    </div>
                  )}
                  <div className="flex justify-end gap-2.5 mt-4 items-center">
                    <button
                      type="button"
                      onClick={onFixNowClick}
                      disabled={projectActions.isLoading}
                      className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                      data-testid="triage-fix-now"
                    >
                      {projectActions.isLoading && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Fix now
                    </button>
                    <button
                      type="button"
                      onClick={onDismiss}
                      disabled={dismiss.isPending || snooze.isPending}
                      className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                      data-testid="triage-dismiss"
                    >
                      {dismiss.isPending && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={onSnooze}
                      disabled={dismiss.isPending || snooze.isPending}
                      className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                      data-testid="triage-snooze"
                    >
                      {snooze.isPending && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Snooze
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromoteOpen(true)}
                      className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5"
                      data-testid="triage-promote"
                    >
                      Promote
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <PromoteModal
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        projectId={projectId}
        item={item}
        onPromoted={() => {
          onActionComplete?.("promoted");
          onOpenChange(false);
        }}
      />
    </>
  );
}
