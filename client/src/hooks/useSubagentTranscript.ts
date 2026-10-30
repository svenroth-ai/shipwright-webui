/*
 * useSubagentTranscript — one subagent's JSONL tail for the Agents window (M4).
 * Fetched ONLY while the Transcript tab is open (`enabled`), on open / window
 * focus / manual `refetch` — no timer (the server reads up to 4 MB per call).
 */

import { useQuery } from "@tanstack/react-query";

import { fetchSubagentTranscript, type SubagentTranscriptResponse } from "../lib/sessionInfoApi";

export function useSubagentTranscript(taskId: string | null | undefined, agentId: string | null | undefined, enabled: boolean, live = true) {
  return useQuery<SubagentTranscriptResponse>({
    queryKey: ["subagent-transcript", taskId ?? "__none__", agentId ?? "__none__"],
    queryFn: () => fetchSubagentTranscript(taskId as string, agentId as string),
    enabled: enabled && Boolean(taskId) && Boolean(agentId),
    staleTime: 15_000,
    refetchOnWindowFocus: live, // a finished agent file cannot change
    retry: false,
  });
}
