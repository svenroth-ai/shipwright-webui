/*
 * useDesignScreens — read the pending design-gate screens (FR-01.58, A14).
 *
 * Read-only observer: fetches `.shipwright/designs/design-manifest.md` through
 * the EXISTING generic `/file` route (served as text/markdown) and parses the
 * "## Screens" table. No new server surface, no write. A missing manifest (the
 * design phase emitted the viewer but no manifest, or zero screens) resolves to
 * an EMPTY list — the gallery renders its honest empty state, never a fabricated
 * gallery (AC5).
 *
 * Enabled only at an active gate (the caller passes `enabled`) so a done /
 * non-gate task never fetches.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchFileText } from "../lib/externalApi";
import { parseDesignManifest, type DesignScreen } from "../lib/designManifest";

/** A "manifest not emitted yet" miss — the `/file` route's 404. Duck-typed on
 *  `.status` (ApiError carries it) so it holds across module boundaries. */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { status?: unknown }).status === 404
  );
}

const DESIGN_MANIFEST_REL = ".shipwright/designs/design-manifest.md";

const DESIGN_SCREENS_KEY = (projectId: string | null | undefined) =>
  ["design-screens", projectId ?? "__none__"] as const;

export interface DesignScreensResult {
  screens: DesignScreen[];
  isLoading: boolean;
  /** True once the fetch has resolved (success OR handled miss) — lets the
   *  gallery distinguish "still loading" from "loaded, zero screens". */
  isResolved: boolean;
  /** A REAL load failure (network / 5xx / oversized), as opposed to a missing
   *  manifest. The gallery renders a distinct honest "couldn't load" state for
   *  this — a 404 (no manifest emitted yet) is NOT an error, it is empty. */
  isError: boolean;
}

export function useDesignScreens(
  projectId: string | null | undefined,
  enabled: boolean,
): DesignScreensResult {
  const query = useQuery<DesignScreen[]>({
    queryKey: DESIGN_SCREENS_KEY(projectId),
    queryFn: async () => {
      try {
        const { text } = await fetchFileText(projectId!, DESIGN_MANIFEST_REL);
        return parseDesignManifest(text);
      } catch (err) {
        // No manifest emitted yet (404) → honest EMPTY, not an error surface
        // (the gate is still valid). Any OTHER failure (5xx, network, oversized)
        // is a real error and must NOT masquerade as "no previews".
        if (isNotFound(err)) return [];
        throw err;
      }
    },
    enabled: Boolean(projectId) && enabled,
    staleTime: 5_000,
    // A transient error self-heals on the next poll; no per-query retry needed.
    refetchInterval: 10_000,
  });

  return {
    screens: query.data ?? [],
    isLoading: query.isLoading,
    isResolved: query.isFetched,
    isError: query.isError,
  };
}
