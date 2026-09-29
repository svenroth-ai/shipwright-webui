/*
 * useCampaignReadiness — the scheduler's ready/blocked verdict for ONE campaign.
 *
 * Deliberately separate from `useCampaigns` (3 s poll): the server-side command
 * may run `git fetch origin`, so this polls slowly (20 s) and only while the
 * card is expanded and the campaign is actually running (`enabled`). The server
 * also caches + coalesces, so two tabs cost one spawn.
 */

import { useQuery } from "@tanstack/react-query";

import {
  campaignReadinessKey,
  fetchCampaignReadiness,
  READINESS_API_POLL_MS,
  type CampaignReadiness,
} from "../lib/campaignReadinessApi";

export function useCampaignReadiness(
  projectId: string | null | undefined,
  slug: string,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<CampaignReadiness>({
    queryKey: campaignReadinessKey(projectId ?? "", slug),
    queryFn: () => fetchCampaignReadiness(projectId as string, slug),
    enabled: Boolean(projectId) && (opts.enabled ?? true),
    refetchInterval: READINESS_API_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: READINESS_API_POLL_MS / 2,
    retry: false,
  });
}
