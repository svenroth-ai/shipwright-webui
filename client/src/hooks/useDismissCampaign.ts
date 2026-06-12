/*
 * useDismissCampaign — mutation wrapper for the board's manual campaign
 * dismiss/restore action (iterate-2026-06-12). Toggles a webui-owned board
 * quittance (NOT a producer status) and, on success, invalidates the board's
 * campaigns query so the card moves between the active lane and the dismissed
 * list without a reload.
 *
 * `dismissed` in the variables is the campaign's CURRENT state: a currently-
 * dismissed campaign restores, otherwise it dismisses. Idempotent server-side.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { dismissCampaign, restoreCampaign } from "../lib/campaignsApi";
import { campaignsKey } from "./useCampaigns";

export interface DismissCampaignVars {
  slug: string;
  /** The campaign's current dismissed state — true → restore, false → dismiss. */
  dismissed: boolean;
}

export function useDismissCampaign(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DismissCampaignVars>({
    mutationFn: ({ slug, dismissed }) =>
      dismissed ? restoreCampaign(projectId, slug) : dismissCampaign(projectId, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignsKey(projectId) });
    },
  });
}
