/*
 * useMissionContext.ts — the Mission-context resolver query
 * (campaign 2026-07-18-mission-artifacts, Slice 1).
 *
 * Poll cadence is DELIBERATELY slower than the 1 s transcript poll (CONTRACT
 * §5.2): live narration and the stage come from the transcript, but the
 * artifact MAP changes only at lifecycle boundaries (spec written, run
 * finalized, PR merged). Polling it at 1 s would re-stat the event log, the
 * spec and the fold map every second for no user-visible gain.
 *
 * The document body is fetched ON CLICK only — the context response carries
 * metadata, never bodies (§5.2 "metadata-first").
 */

import { useQuery } from "@tanstack/react-query";

import {
  fetchArtifactDocument,
  fetchMissionContext,
  type ArtifactDocumentResponse,
  type MissionContext,
} from "../lib/missionContextApi";

/** 10 s — fast enough that Finalize lands without a manual refresh, cheap enough to poll. */
export const MISSION_CONTEXT_POLL_MS = 10_000;

const contextKey = (taskId: string | null | undefined) =>
  ["mission-context", taskId ?? "__none__"] as const;

const documentKey = (taskId: string | null | undefined, documentId: string | null | undefined) =>
  ["mission-context", "document", taskId ?? "__none__", documentId ?? "__none__"] as const;

/**
 * Resolve the Mission context for a task. Disabled without a taskId.
 * `retry: false` — an unknown task is a stable 404, not a transient failure;
 * the rail simply renders nothing and the legacy view stays in place.
 */
export function useMissionContext(taskId: string | null | undefined) {
  return useQuery<MissionContext>({
    queryKey: contextKey(taskId),
    queryFn: () => fetchMissionContext(taskId as string),
    enabled: Boolean(taskId),
    refetchInterval: MISSION_CONTEXT_POLL_MS,
    retry: false,
    staleTime: MISSION_CONTEXT_POLL_MS,
  });
}

/**
 * Fetch one artifact's document body by its OPAQUE server-minted id. Runs only
 * when a document node is actually open, so the rail costs one request per
 * click rather than N per poll.
 */
export function useArtifactDocument(
  taskId: string | null | undefined,
  documentId: string | null | undefined,
) {
  return useQuery<ArtifactDocumentResponse>({
    queryKey: documentKey(taskId, documentId),
    queryFn: () => fetchArtifactDocument(taskId as string, documentId as string),
    enabled: Boolean(taskId && documentId),
    retry: false,
    // A document body is immutable for a given sourceRev — the id changes when
    // the source does, so the cache entry can never go stale under its own key.
    staleTime: Infinity,
  });
}
