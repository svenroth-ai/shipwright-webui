import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

import type { TriageItem } from "../../lib/triageApi";
import {
  useDismissTriageItem,
  useSnoozeTriageItem,
  useTriageDisplayItem,
  useTriageDrift,
} from "../../hooks/useTriage";
import { useProjectActions } from "../../hooks/useProjectActions";
import { useStartCampaign } from "../../hooks/useStartCampaign";
import { CampaignStartCta } from "./CampaignStartCta";
import { PromoteModal } from "./PromoteModal";
import { SnoozeRevisitField } from "./SnoozeRevisitField";
import { TriageDetailHeader } from "./TriageDetailHeader";
import { TriageDetailMeta } from "./TriageDetailMeta";
import { TriageFilePanel } from "./TriageFilePanel";
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
  /**
   * FR-01.33 — invoked after a campaign-umbrella item's "Start Campaign"
   * (draft → active) succeeds, or immediately on "Go to board" (already
   * active). The parent (TriagePage) owns navigation + project-filter state
   * (router/useProjectFilter need page-level context — same parent-owns
   * pattern as `onFixNow`). When omitted the buttons still render but clicks
   * only flip status without navigating.
   */
  onNavigateToBoard?: () => void;
}

function flipErrorMessage(result: { status: number; body: unknown }, action: string): string {
  const body = result.body as { error?: string; message?: string };
  return body.message || `${action} failed (${result.status}): ${body.error}`;
}

export function TriageDetailModal({
  open,
  onOpenChange,
  projectId,
  item,
  onActionComplete,
  onFixNow,
  onNavigateToBoard,
}: TriageDetailModalProps) {
  const dismiss = useDismissTriageItem(projectId);
  const snooze = useSnoozeTriageItem(projectId);
  const startCampaignMut = useStartCampaign(projectId);
  const projectActions = useProjectActions(projectId);
  const drift = useTriageDrift(projectId);
  const displayItem = useTriageDisplayItem(projectId, item);
  const [reason, setReason] = useState("");
  const [revisitAt, setRevisitAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [fixNowFailure, setFixNowFailure] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const writeDisabled = drift.data?.write?.available === false;
  const writeDisabledReason = drift.data?.write?.reason ?? "Triage writing is unavailable.";

  useEffect(() => {
    setFixNowFailure(null);
    setStartError(null);
    setEditMode(false);
    setOpenFilePath(null);
  }, [item.id, open]);

  // FR-01.33 — campaign-umbrella branch. A triage item the producer linked to
  // a campaign carries `campaignSlug` (+ lifecycle status). draft/null → offer
  // "Start Campaign" (flip to active); active → "Go to board"; complete → no
  // CTA. The campaign CTA being shown demotes Fix-now to a secondary style.
  const campaignSlug = displayItem.campaignSlug ?? null;
  const campaignStatus = displayItem.campaignStatus ?? null;
  const isCampaignItem = Boolean(campaignSlug);
  // Fix-now is demoted to a secondary style whenever a campaign CTA competes
  // for primary attention (draft/active/legacy-null) — but NOT when the
  // campaign is complete (no CTA shown, so Fix-now keeps its primary style).
  const showCampaignCta = isCampaignItem && campaignStatus !== "complete";
  const fixNowButtonClass = showCampaignCta
    ? "h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
    : "h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5";

  const onStartCampaign = async () => {
    if (!campaignSlug) return;
    setStartError(null);
    try {
      const result = await startCampaignMut.mutateAsync(campaignSlug);
      if (!result.ok) {
        setStartError(result.message || `Start campaign failed (${result.status}): ${result.error}`);
        return;
      }
      onNavigateToBoard?.();
      onOpenChange(false);
    } catch (err) {
      // Transport failure (server restarted mid-click / non-JSON body):
      // startCampaign's discriminated result only covers HTTP errors, so a
      // rejected fetch must be surfaced inline rather than becoming an
      // unhandled rejection (review MEDIUM #4).
      setStartError(
        `Start campaign failed — could not reach the server. ${String(err).slice(0, 120)}`,
      );
    }
  };

  const onGoToBoard = () => {
    onNavigateToBoard?.();
    onOpenChange(false);
  };

  const onFixNowClick = () => {
    setFixNowFailure(null);
    if (!onFixNow) {
      setFixNowFailure("Fix-now handler not wired on this page.");
      return;
    }
    const result = buildFixNowIntent(displayItem, projectActions.data, projectId);
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
      setError(flipErrorMessage(result, "Dismiss"));
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
      revisitAt: revisitAt.trim() || undefined,
    });
    if (!result.ok) {
      setError(flipErrorMessage(result, "Snooze"));
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
            className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex overflow-hidden bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] ${
              openFilePath ? "h-[85vh] w-[1440px] max-w-[95vw]" : "max-h-[85vh] w-[640px] max-w-[90vw]"
            }`}
            data-testid="triage-detail-modal"
          >
            <div
              className={`w-full min-w-0 overflow-y-auto p-6 md:w-[640px] md:shrink-0 ${
                openFilePath ? "hidden md:block" : ""
              }`}
            >
              <TriageDetailHeader
                item={displayItem}
                editMode={editMode}
                onEdit={() => setEditMode(true)}
                writeDisabled={writeDisabled}
                writeDisabledReason={writeDisabledReason}
              />

              <TriageDetailMeta
                projectId={projectId}
                item={displayItem}
                editMode={editMode}
                onEditDone={() => setEditMode(false)}
                writesRouteToOutbox={drift.data?.writesRouteToOutbox}
                writeDisabled={writeDisabled}
                writeDisabledReason={writeDisabledReason}
                onOpenFile={setOpenFilePath}
              />

              {isCampaignItem && campaignSlug && (
                <CampaignStartCta
                  slug={campaignSlug}
                  status={campaignStatus}
                  isStarting={startCampaignMut.isPending}
                  error={startError}
                  onStart={onStartCampaign}
                  onGoToBoard={onGoToBoard}
                />
              )}

              {displayItem.status === "triage" && !editMode && (
                <div className="border-t border-[var(--color-border)] pt-4 mt-4">
                  {writeDisabled && (
                    <div
                      className="mb-3 p-2 text-xs text-warn bg-warn-tint border border-[var(--warn-line)] rounded"
                      data-testid="triage-write-unavailable"
                    >
                      Triage actions are unavailable: {writeDisabledReason}
                    </div>
                  )}
                  <label className="block">
                    <span className="text-xs font-medium text-[var(--color-text)]">
                      Reason (optional, applies to Dismiss / Snooze)
                    </span>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm border border-[var(--color-border)] rounded"
                      placeholder="out of scope this sprint"
                      data-testid="triage-action-reason"
                    />
                  </label>
                  <SnoozeRevisitField value={revisitAt} onChange={setRevisitAt} disabled={dismiss.isPending || snooze.isPending} />
                  {error && (
                    <div
                      className="mt-3 p-2 text-xs text-err bg-err-tint border border-[var(--err-line)] rounded"
                      data-testid="triage-action-error"
                    >
                      {error}
                    </div>
                  )}
                  {fixNowFailure && (
                    <div
                      className="mt-3 p-2 text-xs text-err bg-err-tint border border-[var(--err-line)] rounded"
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
                      className={fixNowButtonClass}
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
                      disabled={writeDisabled || dismiss.isPending || snooze.isPending}
                      title={writeDisabled ? writeDisabledReason : undefined}
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
                      disabled={writeDisabled || dismiss.isPending || snooze.isPending}
                      title={writeDisabled ? writeDisabledReason : undefined}
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
                      disabled={writeDisabled}
                      title={writeDisabled ? writeDisabledReason : undefined}
                      className="h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                      data-testid="triage-promote"
                    >
                      Promote
                    </button>
                  </div>
                </div>
              )}
            </div>
            {openFilePath && (
              <TriageFilePanel
                projectId={projectId}
                path={openFilePath}
                onClose={() => setOpenFilePath(null)}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <PromoteModal
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        projectId={projectId}
        item={displayItem}
        writeDisabled={writeDisabled}
        writeDisabledReason={writeDisabledReason}
        onPromoted={() => {
          onActionComplete?.("promoted");
          onOpenChange(false);
        }}
      />
    </>
  );
}
