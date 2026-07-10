/*
 * useDesignGate — poll the single-session design-gate state (FR-01.45).
 *
 * Enabled only when the caller says so (single_session + non-terminal run); the
 * `SingleSessionRunCard` passes `enabled` so a terminal / multi-session run
 * never polls. Pure read-only observer.
 */

import { useQuery } from "@tanstack/react-query";

import { getDesignGate, type DesignGate } from "../lib/designReviewApi";

const DESIGN_GATE_KEY = (projectId: string | null | undefined) =>
  ["design-gate", projectId ?? "__none__"] as const;

const POLL_MS = 5_000;

export function useDesignGate(
  projectId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<DesignGate>({
    queryKey: DESIGN_GATE_KEY(projectId),
    queryFn: () => getDesignGate(projectId!),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}
