/*
 * masterRunApi.ts — client wrapper for the single-session master launch
 * (campaign webui-pipeline-convergence, sub-iterate W2 / FR pipeline family).
 *
 * Sibling of `campaignsApi.launchCampaignRun`: an own wrapper (NOT `externalApi`'s
 * `launchTask`) so the bloat-ceilinged `externalApi.ts` stays frozen (project
 * memory: externalApi is at the bloat ceiling; new API wrappers get their own
 * `lib/<feature>Api.ts` importing `httpJson` + `EXTERNAL_API`).
 *
 * The client sends ONLY `{ masterRun: true }` (plus, for an already-established
 * master, `resume: true`). The server's master-run branch validates the run
 * against a readable single_session run_config and builds the `/shipwright-run`
 * command entirely server-side — the client never dictates the command
 * (Architecture rule 1 / regression guard #19). This is NOT a per-phase pipeline
 * continuation (no phaseTaskId); it launches the master orchestrator that drives
 * every phase in one conversation, so it does not route through
 * `useContinuePipeline` (conventions rule 14 is about per-phase Continue).
 *
 * `resume` (default false): a fresh master start injects `/shipwright-run`; a
 * resume of an already-established master (its `<uuid>.jsonl` exists) sends
 * `resume: true` so the server falls through to the legacy `--resume <uuid>`
 * shape — re-injecting `--session-id <uuid>` would make Claude reject a duplicate
 * session id ("Session ID already in use"). masterRun + resume is NOT a mixed
 * intent (only actionId / phaseTaskRef / campaignSlug / campaignStep are).
 */

import {
  httpJson,
  EXTERNAL_API,
  type CopyCommandForms,
  type ExternalTask,
} from "./externalApi";

export async function launchMasterRun(
  taskId: string,
  resume = false,
): Promise<{ task: ExternalTask; commands: CopyCommandForms }> {
  return await httpJson<{ task: ExternalTask; commands: CopyCommandForms }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masterRun: true, ...(resume ? { resume: true } : {}) }),
    },
  );
}
