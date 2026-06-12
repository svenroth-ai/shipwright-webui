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
 * A campaign is effectively done when the producer marked it `complete`, OR
 * every step is finished (`total > 0 && done >= total`). The second clause is
 * load-bearing: a campaign driven via individual sub-iterate PRs (rather than
 * the autonomous loop's `update-status` call, which auto-flips active→complete)
 * never gets its lifecycle bumped, so it stays `active` even at done==total.
 * Without this clause such a campaign rendered on the board forever (reported
 * 2026-06-05). `total === 0` (a freshly-started campaign with no steps yet) is
 * never "done".
 */
export function isCampaignDone(c: Campaign): boolean {
  return c.status === "complete" || (c.total > 0 && c.done >= c.total);
}

/**
 * Campaigns the board's default lane should show — running work only. Hidden:
 *   - `draft`            → planned; lives only in Triage.
 *   - done               → `complete` lifecycle OR every step finished
 *                          (done >= total), even with a stale `active`
 *                          lifecycle — see `isCampaignDone`.
 *   - legacy idle        → status `null` AND nothing left (done >= total, or
 *                          no steps; the latter also guards the progress-bar
 *                          divide-by-zero).
 * Shown: `active` with work remaining (incl. a fresh campaign with no steps
 * yet), or legacy (`null`) with `done < total`.
 *
 * Exception — `derivedFromEvents`: an events-only campaign (planning dir absent
 * on a deployed clone) carries ONLY completed sub-iterates, so it always reads
 * `done == total` and `isCampaignDone` would hide it. But events can't reveal
 * pending steps, so "all known steps done" ≠ "campaign finished" — we keep it
 * visible so the deployed board surfaces its progress (the whole point of the
 * projection). `draft` is impossible for a synthesized campaign (status null).
 */
export function selectActiveCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((c) => {
    if (c.status === "draft") return false;
    if (c.derivedFromEvents) return true;
    if (isCampaignDone(c)) return false;
    if (c.status === "active") return true;
    return c.total > 0 && c.done < c.total; // legacy fallback (status null)
  });
}

/**
 * The default board lane: campaigns that would show (`selectActiveCampaigns`)
 * minus those an operator dismissed. `dismissed` is a webui-owned board
 * quittance (NOT a producer status); layered ON TOP of `selectActiveCampaigns`
 * so the would-be-visible rules stay unchanged. A missing `dismissed` (older
 * server / deploy-skew) is treated as not dismissed.
 */
export function selectVisibleCampaigns(campaigns: Campaign[]): Campaign[] {
  return selectActiveCampaigns(campaigns).filter((c) => !c.dismissed);
}

/**
 * The dismissed subset of the would-be-visible campaigns — the restore list
 * behind the "show dismissed" toggle. A campaign hidden for ANY other reason
 * (draft / done / legacy-idle) is NOT here; only ones the operator actively
 * dismissed that would otherwise occupy the lane.
 */
export function selectDismissedCampaigns(campaigns: Campaign[]): Campaign[] {
  return selectActiveCampaigns(campaigns).filter((c) => Boolean(c.dismissed));
}

/**
 * The not-yet-complete steps that an autonomous campaign run should NOT execute
 * unattended without an explicit acknowledgment: a step that previously `failed`
 * or `escalated` (the loop would blindly re-run it), or one flagged `planFirst`
 * via its sub-iterate spec frontmatter. Drives the autonomous-launch confirm
 * dialog's risky-step warning (FR-01.34 guardrail #2). Empty = clean to run.
 */
export function selectRiskyPendingSteps(campaign: Campaign): CampaignStep[] {
  return campaign.steps.filter(
    (s) =>
      s.status !== "complete" &&
      (s.status === "failed" || s.status === "escalated" || s.planFirst),
  );
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
): Promise<{ task: ExternalTask; commands: CopyCommandForms }> {
  return await httpJson<{ task: ExternalTask; commands: CopyCommandForms }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignStep: { slug: campaignSlug, stepId } }),
    },
  );
}
