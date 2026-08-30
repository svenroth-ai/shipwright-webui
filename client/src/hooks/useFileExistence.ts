import { useQuery } from "@tanstack/react-query";
import { checkFilesExist } from "../lib/fileExistsApi";

// Mirrors the server's MAX_PATHS_PER_REQUEST (exists-routes.ts) — capping
// here too means a triage item with more distinct mentions than that still
// gets its first 50 upgraded to links instead of the whole batch 400ing and
// leaving every mention (including the ones well under the cap) as plain
// text (doubt-review finding, iterate-2026-08-30-triage-file-viewer-followups).
const MAX_PATHS_PER_CHECK = 50;

/**
 * Resolves which of `paths` actually exist under the project, for the
 * Triage file viewer's link-vs-plain-text decision
 * (iterate-2026-08-30-triage-file-viewer-followups). Returns `null` while
 * loading or on error — callers treat `null` as "not known to exist yet",
 * so nothing is ever linkified as a false positive; it only ever upgrades
 * text to a link once existence is confirmed, never the other way round.
 */
export function useFileExistence(
  projectId: string,
  paths: string[],
): Set<string> | null {
  const sortedPaths = [...new Set(paths)].sort().slice(0, MAX_PATHS_PER_CHECK);
  const { data } = useQuery({
    queryKey: ["file-existence", projectId, sortedPaths],
    queryFn: () => checkFilesExist(projectId, sortedPaths),
    enabled: sortedPaths.length > 0,
    staleTime: 30_000,
  });
  if (!data) return sortedPaths.length === 0 ? new Set() : null;
  return new Set(Object.entries(data).filter(([, ok]) => ok).map(([p]) => p));
}
