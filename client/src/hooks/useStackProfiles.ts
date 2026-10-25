import { useQuery } from "@tanstack/react-query";

import { getStackProfiles, stackProfilesKey } from "../lib/stackProfilesApi";

/** Resolver-backed profile list. `projectId` adds that project's own profiles;
 *  omit it for user + built-in only (the Intent Wizard, where the project
 *  doesn't exist yet). Short staleTime: users edit profile files by hand. */
export function useStackProfiles(projectId?: string | null, enabled = true) {
  return useQuery({
    queryKey: stackProfilesKey(projectId),
    queryFn: () => getStackProfiles(projectId),
    enabled,
    staleTime: 10_000,
  });
}
