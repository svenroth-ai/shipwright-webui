/*
 * useCampaigns — polls GET /api/campaigns/:projectId for the active project.
 *
 * 3 s poll (POLL_MS) matches the triage / inbox family so a status.json flip
 * shows on the board without a reload. Mirror of `useTriageItems`.
 */

import { useQuery } from "@tanstack/react-query";

import { listCampaigns, type Campaign } from "../lib/campaignsApi";

export const POLL_MS = 3_000;

/** Shared query key so mutations (useStartCampaign) can invalidate the lane. */
export const campaignsKey = (projectId: string) =>
  ["campaigns", projectId] as const;

export function useCampaigns(
  projectId: string | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<Campaign[]>({
    queryKey: campaignsKey(projectId ?? ""),
    queryFn: () => {
      if (!projectId) return Promise.resolve([]);
      return listCampaigns(projectId);
    },
    enabled: Boolean(projectId) && (opts.enabled ?? true),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}
