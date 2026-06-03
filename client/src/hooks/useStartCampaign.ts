/*
 * useStartCampaign — mutation wrapper for the Triage "Start Campaign" action
 * (FR-01.33). POSTs draft → active and, on success, invalidates the board's
 * campaigns query so the freshly-activated campaign appears without a reload.
 *
 * Lives in hooks/ (NOT a triage source file) so it may import the campaign
 * API freely — the campaigns-no-triage-coupling guard only permits the Triage
 * surface to import THIS hook (the single sanctioned cross-surface action),
 * never the campaign API / lane modules directly.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { startCampaign, type StartCampaignOutcome } from "../lib/campaignsApi";
import { campaignsKey } from "./useCampaigns";

export function useStartCampaign(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<StartCampaignOutcome, Error, string>({
    mutationFn: (slug: string) => startCampaign(projectId, slug),
    onSuccess: (result) => {
      // Only refresh the lane when the write actually landed — a 409/422/503
      // result leaves campaign state untouched, so there's nothing to refetch.
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: campaignsKey(projectId),
        });
      }
    },
  });
}
