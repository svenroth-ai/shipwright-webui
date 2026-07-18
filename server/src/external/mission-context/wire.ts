/*
 * external/mission-context/wire.ts — production wiring for the Mission-context
 * router, kept OUT of the registration shell so `external/routes.ts` stays
 * within the file-size rule.
 *
 * The transcript is read HERE, from the server's own `SessionWatcher`, and only
 * a bounded TAIL of it. Two reasons, both from the CONTRACT:
 *   - §5.1 input trust boundary: the client never supplies transcript content,
 *     so a forged `pr-link` marker cannot reach the merge check.
 *   - §5.2 bounded resolver: a multi-megabyte JSONL must not be re-read whole
 *     on a poll; the delivery marker is always near the end.
 */

import { createMissionContextRouter, TRANSCRIPT_TAIL_BYTES } from "./routes.js";
import { getScenarioFacts } from "./facts.js";
import type { SessionWatcher } from "../../core/session-watcher.js";
import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface WiredMissionContextDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  getProjectById: (id: string) => ExternalRouteProjectView | undefined;
  readRunConfig: (projectPath: string) => Promise<RunConfigReadResult>;
}

export function createWiredMissionContextRouter(deps: WiredMissionContextDeps) {
  const { store, watcher, getProjectById, readRunConfig } = deps;
  return createMissionContextRouter({
    store,
    getProjectById,
    readTranscriptTail: async (sessionUuid: string) => {
      try {
        const loc = await watcher.findByUuid(sessionUuid);
        if (!loc) return "";
        const fromByte = Math.max(0, loc.sizeBytes - TRANSCRIPT_TAIL_BYTES);
        const r = await watcher.readChunk({ sessionUuid, fromByte, expectFingerprint: null });
        return r.status === "ok" ? r.chunk.content : "";
      } catch {
        // A transcript fault degrades the PR marker (merge → "unknown"), and
        // must never fail the context read itself.
        return "";
      }
    },
    getScenarioFacts: (project, task) => getScenarioFacts(project, task, { readRunConfig }),
  });
}
