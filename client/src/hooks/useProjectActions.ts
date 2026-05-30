/*
 * TanStack Query wrapper around `getProjectActions(projectId)`.
 *
 * Iterate 3 section 03:
 *   - Stale-time 30 s (actions.json rarely changes — the server already
 *     mtime-caches the file read, but the client budget keeps the UI
 *     from refetching on every modal open).
 *   - Invalidated on project change (the key includes projectId).
 *   - `useSaveActionsStub` auto-invalidates the matching queryKey so the
 *     wizard's "Custom" branch refreshes the dropdown without a reload.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getProjectActions,
  resetActionsJson,
  saveActionsStub,
  uploadActionsJson,
  type ResolvedProjectActions,
} from "../lib/externalApi";

const ACTIONS_KEY = (projectId: string | null | undefined) =>
  ["project-actions", projectId ?? "__none__"] as const;

/**
 * Fetch actions schema for a specific project. Pass `null`/`undefined` to
 * disable the query (e.g. while the active project is still resolving).
 */
export function useProjectActions(projectId: string | null | undefined) {
  return useQuery<ResolvedProjectActions>({
    queryKey: ACTIONS_KEY(projectId),
    queryFn: () => getProjectActions(projectId!),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

/**
 * Server-write for the wizard's Custom branch. Stub creation is idempotent
 * on disk, so callers can retry on transient errors without leaking state.
 */
export function useSaveActionsStub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string; mode?: "custom" }) =>
      saveActionsStub(projectId, "custom"),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ACTIONS_KEY(vars.projectId) });
    },
  });
}

/**
 * FR-01.27 — upload the contents of a user-picked .json file as the new
 * `<project.path>/.shipwright-webui/actions.json`. On success the cached resolved
 * catalog for that project is invalidated so the New-* dropdowns
 * re-fetch immediately.
 */
export function useUploadActionsJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      jsonContent,
    }: {
      projectId: string;
      jsonContent: string;
    }) => uploadActionsJson(projectId, jsonContent),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ACTIONS_KEY(vars.projectId) });
    },
  });
}

/**
 * FR-01.27 — remove the user override and fall back to the bundled
 * default. Same invalidation hook as upload.
 */
export function useResetActionsJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) =>
      resetActionsJson(projectId),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ACTIONS_KEY(vars.projectId) });
    },
  });
}
