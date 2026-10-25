import { useQuery } from "@tanstack/react-query";

import { adoptScanKey, scanAdoptProfile } from "../lib/adoptScanApi";

/** Read-only profile scan of a LOCAL repo. Keyed by path, so a slow answer for
 *  repo A can never overwrite what is shown for repo B. No retry: a scan is
 *  seconds of work and a failure is shown, not hammered. */
export function useAdoptScan(path: string, enabled: boolean) {
  return useQuery({
    queryKey: adoptScanKey(path),
    queryFn: () => scanAdoptProfile(path),
    enabled: enabled && path.length > 0,
    // only a real answer is worth remembering; busy / failed / engine-unavailable are
    // transient and must be re-asked when the user comes back to the screen
    staleTime: (q) => (q.state.data?.status === "ok" ? 60_000 : 0),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
