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
 *
 * The window is CLAMPED here, not trusted from the caller: never below the
 * ordinary tail (so the PR marker keeps its reach) and never above
 * `RECOVERY_TAIL_BYTES` (so no code path can turn this into an unbounded read of
 * a multi-MB JSONL).
 */

import {
  createMissionContextRouter,
  RECOVERY_TAIL_BYTES,
  TRANSCRIPT_TAIL_BYTES,
} from "./routes.js";
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
    readTranscriptTail: async (sessionUuid: string, maxBytes?: number) => {
      try {
        const loc = await watcher.findByUuid(sessionUuid);
        if (!loc) return { text: "", revision: "" };
        const budget = Math.min(
          Math.max(maxBytes ?? TRANSCRIPT_TAIL_BYTES, TRANSCRIPT_TAIL_BYTES),
          RECOVERY_TAIL_BYTES,
        );
        const fromByte = Math.max(0, loc.sizeBytes - budget);
        const r = await watcher.readChunk({ sessionUuid, fromByte, expectFingerprint: null });
        if (r.status !== "ok") return { text: "", revision: "" };
        // Already in hand from the SAME `findByUuid` walk, so scheduling the
        // wide reach-back costs no extra I/O. All three parts earn their place:
        // `path` catches a transcript REPLACED under the same session uuid,
        // `sizeBytes` the ordinary append, `mtimeMs` an in-place rewrite that
        // happens to preserve the length.
        return { text: r.chunk.content, revision: `${loc.path}:${loc.sizeBytes}:${loc.mtimeMs}` };
      } catch {
        // A transcript fault degrades the PR marker (merge → "unknown"), and
        // must never fail the context read itself. No revision, so the reach-back
        // schedule treats it as "we learned nothing".
        return { text: "", revision: "" };
      }
    },
    getScenarioFacts: (project, task) => getScenarioFacts(project, task, { readRunConfig }),
  });
}
