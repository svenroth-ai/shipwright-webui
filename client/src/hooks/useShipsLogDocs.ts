/*
 * useShipsLogDocs — TanStack Query wrapper for the Ship's-Log Documents
 * panel (iterate-2026-08-31-shipslog-documents-panel). These are
 * mostly-static project docs (spec.md, agent_docs, compliance) — a much
 * slower cadence than the 30 s run-data poll (RUN_DATA_POLL_MS in
 * useRunData.ts) is ample. Pure observer — the WebUI never writes these
 * files from this surface (Architecture rule 1).
 */

import { useQuery } from "@tanstack/react-query";

import { getShipsLogDocs, type ShipsLogDocsResponse } from "../lib/shipsLogDocsApi";

/** 2 min — these are mostly-static docs, not live data. */
export const SHIPSLOG_DOCS_POLL_MS = 120_000;

export function useShipsLogDocs(projectId: string | null | undefined) {
  return useQuery<ShipsLogDocsResponse>({
    queryKey: ["shipslog-docs", projectId ?? "__none__"],
    queryFn: () => getShipsLogDocs(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: SHIPSLOG_DOCS_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  });
}
