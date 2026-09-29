/*
 * campaignsApi.ts — client wrapper for the Campaigns lane endpoint (FR-01.31).
 *
 * Read-only sibling of `triageApi.ts`: raw `fetch` (the right precedent for a
 * loopback `/api/*` endpoint), 404 → [] so an unknown/synthesized project never
 * crashes the lane. Types mirror `server/src/core/campaign-store.ts`.
 */

import {
  httpJson,
  EXTERNAL_API,
  type CopyCommandForms,
  type ExternalTask,
} from "./externalApi";

export {
  isCampaignDone,
  selectActiveCampaigns,
  selectVisibleCampaigns,
  selectDismissedCampaigns,
  selectDraftCampaigns,
  campaignLifecycleLabel,
  selectRiskyPendingSteps,
} from "./campaignSelectors";

export const CAMPAIGNS_API = "/api/campaigns";

export type CampaignStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "escalated";

/** Producer-owned campaign lifecycle status (mirror of the server type).
 *  draft = planned (triage-only), active = running (board), complete = done. */
export type CampaignLifecycleStatus = "draft" | "active" | "complete";

export interface CampaignStep {
  id: string;
  slug: string;
  title: string;
  status: CampaignStepStatus;
  /** Project-root-relative POSIX path to the sub-iterate spec, or null when
   *  the file is missing / unsafe (the copy-launch button disables on null). */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  /** Forward-compat plan-first/risk marker from the sub-iterate spec frontmatter
   *  (mirror of the server type). False for every campaign today; surfaces in the
   *  autonomous-launch risky-step warning the day a producer emits one. */
  planFirst: boolean;
  /** Ids this step waits on (monorepo `depends_on` graph). DISPLAY ONLY —
   *  launchability is the scheduler's verdict (`campaignReadinessApi.ts`), never
   *  derived from these edges. Optional for deploy-skew safety. */
  dependsOn?: string[];
}

export interface Campaign {
  slug: string;
  intent: string;
  branchStrategy: string | null;
  expandsTriage: string | null;
  /** Producer-owned lifecycle status; null = legacy (no status written yet). */
  status: CampaignLifecycleStatus | null;
  steps: CampaignStep[];
  done: number;
  total: number;
  nextPending: { id: string; specPath: string | null } | null;
  /** True when an autonomous run is currently attached to this campaign — a
   *  live `loop_state.json` `in_progress` unit, OR a `status.json` step
   *  `in_progress`. Populated server-side by `routes/campaigns.ts`; the launch
   *  CTAs disable/relabel on it to avoid spawning a second orchestrator.
   *  Optional for deploy-skew safety (older server → absent → treat as false).
   *  Mirror of `server/src/core/campaign-store.ts`. */
  attachedRun?: boolean;
  /** True when reconstructed purely from the tracked `shipwright_events.jsonl`
   *  because the campaign's planning dir is gitignored/absent (a fresh clone /
   *  redeploy). Completed sub-iterates only — no skeleton, `total == done`,
   *  every `specPath` null (launch CTAs disable). `selectActiveCampaigns` keeps
   *  it visible so the deployed board still surfaces progress. Server-set
   *  (`core/campaign-events.ts`); optional for deploy-skew safety. Mirror of
   *  `server/src/core/campaign-store.ts`. */
  derivedFromEvents?: boolean;
  /** True when an operator manually dismissed this campaign from the board (a
   *  webui-owned quittance, NOT a producer status). Server-set
   *  (`core/dismissed-campaigns-store.ts` via `routes/campaigns.ts`);
   *  `selectVisibleCampaigns` hides it, `selectDismissedCampaigns` surfaces it
   *  behind the "show dismissed" toggle. Optional for deploy-skew safety. Mirror
   *  of `server/src/core/campaign-store.ts`. */
  dismissed?: boolean;
}

export async function listCampaigns(projectId: string): Promise<Campaign[]> {
  const res = await fetch(`${CAMPAIGNS_API}/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`campaigns list failed: ${res.status}`);
  }
  const body = (await res.json()) as { campaigns: Campaign[] };
  return body.campaigns;
}

/** Success shape of POST /:projectId/:slug/start (server always returns active). */
export interface StartCampaignResult {
  slug: string;
  status: "active";
}

export type StartCampaignOutcome =
  | { ok: true; data: StartCampaignResult }
  | { ok: false; status: number; error: string; message?: string };

/**
 * FR-01.33 — the Triage "Start Campaign" action. POSTs draft → active and
 * returns a discriminated result (mirrors triageApi's dismiss/snooze shape) so
 * the caller can surface 404 / 409 (already complete) / 422 (no writable
 * status target) / 503 (lock busy) inline instead of throwing. This is the ONE
 * WebUI write to campaign state — see server/src/core/campaign-write.ts + ADR.
 */
export async function startCampaign(
  projectId: string,
  slug: string,
): Promise<StartCampaignOutcome> {
  const res = await fetch(
    `${CAMPAIGNS_API}/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}/start`,
    { method: "POST" },
  );
  if (res.ok) {
    return { ok: true, data: (await res.json()) as StartCampaignResult };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return {
    ok: false,
    status: res.status,
    error: body.error ?? "unknown_error",
    message: body.message,
  };
}

/**
 * Toggle a campaign's webui-owned board dismissal (iterate-2026-06-12).
 * `dismiss` hides it from the active lane; `restore` brings it back. Idempotent
 * server-side; this is NOT a producer status write (WebUI is read-only on
 * campaign producer state). Throws on a non-2xx (404 unknown project / 400 bad
 * slug / 503 lock busy) so the caller's mutation surfaces it; the board
 * re-fetches `campaignsKey(projectId)` on success.
 */
async function setCampaignDismissed(
  projectId: string,
  slug: string,
  action: "dismiss" | "restore",
): Promise<void> {
  const res = await fetch(
    `${CAMPAIGNS_API}/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}/${action}`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new Error(`campaign ${action} failed: ${res.status}`);
  }
}

export function dismissCampaign(projectId: string, slug: string): Promise<void> {
  return setCampaignDismissed(projectId, slug, "dismiss");
}

export function restoreCampaign(projectId: string, slug: string): Promise<void> {
  return setCampaignDismissed(projectId, slug, "restore");
}

/**
 * Launch an autonomous campaign run on a (freshly created) task. The server's
 * campaign branch validates the slug + builds the
 * `/shipwright-iterate --campaign <slug> --autonomous` command (the client never
 * dictates the command — Architecture rule 1). Own wrapper (not `externalApi`'s
 * `launchTask`) so the bloat-ceilinged `externalApi.ts` stays frozen.
 */
export async function launchCampaignRun(
  taskId: string,
  campaignSlug: string,
): Promise<{ task: ExternalTask; commands: CopyCommandForms }> {
  return await httpJson<{ task: ExternalTask; commands: CopyCommandForms }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignSlug }),
    },
  );
}

/**
 * Launch a SINGLE campaign sub-iterate (FR-01.36) on a freshly created task.
 * The server's campaign-step branch validates `{ slug, stepId }`, resolves the
 * step's specPath, and builds `/shipwright-iterate "<specPath>"` — the client
 * never dictates the command or the path (Architecture rule 1). Sibling of
 * `launchCampaignRun` (keeps the bloat-ceilinged `externalApi.ts` frozen).
 */
export async function launchCampaignStepRun(
  taskId: string,
  campaignSlug: string,
  stepId: string,
): Promise<{ task: ExternalTask; commands: CopyCommandForms; readinessChecked?: false }> {
  return await httpJson<{ task: ExternalTask; commands: CopyCommandForms; readinessChecked?: false }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignStep: { slug: campaignSlug, stepId } }),
    },
  );
}
