import { useIsMutating } from "@tanstack/react-query";

/** Mutation key shared by `useSnoozeTriageItem` and this guard. */
export const snoozeMutationKey = (projectId: string) => ["triage", "snooze", projectId] as const;

/** True while any snooze for this project is in flight (guards the Dismiss button). */
export function useSnoozePending(projectId: string): boolean {
  return useIsMutating({ mutationKey: snoozeMutationKey(projectId) }) > 0;
}
