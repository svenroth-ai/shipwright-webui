import { useQuery } from "@tanstack/react-query";

import { getCodextenderModels } from "../lib/codextenderModelsApi";
import { useSettings } from "./useSettings";

/** Codextender integration Part B.5 — mirrors `useCodexModels.ts` exactly
 *  (same `enabled`-gates-the-call / `staleTime` reasoning), sourced from the
 *  local proxy instead of the Codex CLI.
 *
 * PR-review round 11 fix — `codextenderPort` is folded into the query key.
 * The server route is already port-scoped (round 4's fix), but without this
 * React Query itself never re-issues the request when the port changes: the
 * query is still "fresh" from the CLIENT's `staleTime` perspective, so a
 * port switch kept showing the previous proxy's model list for up to 2
 * minutes even though the server would have answered correctly immediately. */
export function useCodextenderModels(enabled: boolean) {
  const { data: settings } = useSettings();
  // 4000 matches the server-side default (`runtime-chokepoint.ts`'s
  // `args.codextenderPort ?? 4000`) — a fresh install with no explicit port
  // saved yet must key/fetch the same way the server would resolve it,
  // never wait on `settings` to have loaded first.
  const port = settings?.codextenderPort ?? 4000;
  return useQuery({
    queryKey: ["codextender-models", port],
    queryFn: getCodextenderModels,
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
