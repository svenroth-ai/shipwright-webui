/*
 * useTriageCardActions — the actions behind a card's buttons
 * (iterate-2026-11-08-triage-page-redesign): Fix now, Start campaign / Go to
 * board, Dismiss and the Promote dialog switch. Everything is bound to the
 * ENTRY's own projectId (triage ids can collide across projects), never to
 * a page-level project choice.
 */

import { useState } from "react";

import { useProjectActions } from "../../hooks/useProjectActions";
import { useStartCampaign } from "../../hooks/useStartCampaign";
import { useDismissTriageItem, useTriageDrift } from "../../hooks/useTriage";
import type { TriageItem } from "../../lib/triageApi";
import { buildFixNowIntent, type FixNowIntent } from "./fixNowIntent";

interface Args {
  projectId: string;
  item: TriageItem;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}

function flipError(result: { status: number; body: unknown }, action: string): string {
  const body = result.body as { error?: string; message?: string };
  return body.message || `${action} failed (${result.status}): ${body.error}`;
}

export function useTriageCardActions({ projectId, item, onFixNow, onNavigateToBoard }: Args) {
  const projectActions = useProjectActions(projectId);
  const startCampaign = useStartCampaign(projectId);
  const dismiss = useDismissTriageItem(projectId);
  const drift = useTriageDrift(projectId);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writeDisabled = drift.data?.write?.available === false;
  const writeDisabledReason = drift.data?.write?.reason ?? "Triage writing is unavailable.";

  const campaignSlug = item.campaignSlug ?? null;
  const campaignStatus = item.campaignStatus ?? null;
  const showCampaignCta = Boolean(campaignSlug) && campaignStatus !== "complete";

  const fixNow = () => {
    setError(null);
    const result = buildFixNowIntent(item, projectActions.data, projectId);
    if (result.kind === "failed") {
      setError(result.message);
      return;
    }
    onFixNow(projectId, result.intent);
  };

  const start = async () => {
    if (!campaignSlug) return;
    setError(null);
    try {
      const result = await startCampaign.mutateAsync(campaignSlug);
      if (!result.ok) {
        setError(result.message || `Start campaign failed (${result.status}): ${result.error}`);
        return;
      }
      onNavigateToBoard(projectId);
    } catch (err) {
      setError(`Start campaign failed — could not reach the server. ${String(err).slice(0, 120)}`);
    }
  };

  /** Resolves true when the item was dismissed (the reason popup then closes). */
  const doDismiss = async (reason: string | null): Promise<boolean> => {
    setError(null);
    try {
      const result = await dismiss.mutateAsync({ triageId: item.id, reason });
      if (!result.ok) {
        setError(flipError(result, "Dismiss"));
        return false;
      }
      return true;
    } catch (err) {
      setError(`Dismiss failed — could not reach the server. ${String(err).slice(0, 120)}`);
      return false;
    }
  };

  return {
    fixNow,
    fixNowLoading: projectActions.isLoading,
    startCampaign: start,
    startingCampaign: startCampaign.isPending,
    goToBoard: () => onNavigateToBoard(projectId),
    dismiss: doDismiss,
    dismissing: dismiss.isPending,
    promoteOpen,
    setPromoteOpen,
    writeDisabled,
    writeDisabledReason,
    campaignSlug,
    campaignStatus,
    showCampaignCta,
    error,
  };
}
