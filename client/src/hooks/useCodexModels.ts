import { useQuery } from "@tanstack/react-query";

import { getCodexModels } from "../lib/codexModelsApi";

/**
 * `enabled` gates the CALL, not the fetch, per the fixed conditional-hook
 * finding (external review, 2026-09-19): a caller renders this hook
 * unconditionally and passes whether it currently needs Codex data — the
 * hook itself stays idle (no network request) when `false`.
 *
 * `staleTime` (2 min) is deliberately well under the server's 5-minute
 * success TTL (external review fix, glm) so a client fetch landing near the
 * end of the server's cache window doesn't compound into a much staler
 * effective age on the client too.
 */
export function useCodexModels(enabled: boolean) {
  return useQuery({
    queryKey: ["codex-models"],
    queryFn: getCodexModels,
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
