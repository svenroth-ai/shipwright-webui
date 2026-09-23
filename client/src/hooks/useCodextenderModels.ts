import { useQuery } from "@tanstack/react-query";

import { getCodextenderModels } from "../lib/codextenderModelsApi";

/** Codextender integration Part B.5 — mirrors `useCodexModels.ts` exactly
 *  (same `enabled`-gates-the-call / `staleTime` reasoning), sourced from the
 *  local proxy instead of the Codex CLI. */
export function useCodextenderModels(enabled: boolean) {
  return useQuery({
    queryKey: ["codextender-models"],
    queryFn: getCodextenderModels,
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
