/*
 * leadInventoryApi.ts — typed fetcher over `GET /api/org/inventory`
 * (iterate-2026-09-08-lead-inventory-page). Kept in its own module —
 * `orgApi.ts` is already at its bloat ceiling (see project memory).
 *
 * Every type below is a VERBATIM mirror of `server/src/types/org-inventory.ts`
 * (canonical) and `server/src/types/leadwright-beat-step.ts` — CLAUDE.md
 * rule 7's cross-package mirror discipline.
 */

import { ORG_API } from "./orgApi";
import { decodeApiError } from "./externalApi";

// ---------------------------------------------------------------------------
// Mirrors server/src/types/leadwright-beat-step.ts
// ---------------------------------------------------------------------------

export const BEAT_STEP_BANDS = ["bugfix", "maintenance", "feature", "architecture"] as const;

export type BeatStepBand = (typeof BEAT_STEP_BANDS)[number];

export type BeatStepEffect =
  | { kind: "card"; taskId: string }
  | { kind: "decision"; decisionKey: string }
  | { kind: "none" };

export interface BeatStep {
  at: string;
  band: BeatStepBand;
  summary: string;
  effect: BeatStepEffect;
}

// ---------------------------------------------------------------------------
// Mirrors server/src/external/org/charter-authority-read.ts
// ---------------------------------------------------------------------------

export interface AuthorityBandView {
  id: "bugfix" | "maintenance" | "feature" | "architecture";
  name: string;
  declared: boolean;
  text: string | null;
}

export type CharterAuthorityResult =
  | { measured: true; bands: AuthorityBandView[]; declaredCount: number }
  | { measured: false; reason: string };

// ---------------------------------------------------------------------------
// Mirrors server/src/types/org-inventory.ts
// ---------------------------------------------------------------------------

export type StepsView =
  | { status: "ok"; steps: BeatStep[]; unreadableLines: number }
  | { status: "unreadable" };

export type UnclaimedEffectView = { status: "clear" | "found" | "unknown" };

export type RegisterView = { status: "ok" | "unreadable" };

export interface BeatInventoryView {
  beatId: string;
  startedAt: string;
  closedAt: string | null;
  steps: StepsView;
  unclaimedEffect: UnclaimedEffectView;
}

export type AuthorityPanelView = CharterAuthorityResult;

export interface LeadInventoryEntry {
  leadId: string;
  totalBeatsInRegister: number;
  beats: BeatInventoryView[];
  register: RegisterView;
  authority: AuthorityPanelView;
}

export type LeadInventoryResponse = Record<string, LeadInventoryEntry>;

// ---------------------------------------------------------------------------
// Fetcher.
// ---------------------------------------------------------------------------

/** `GET /api/org/inventory` — every lead's last-night beats + authority
 *  panel, one call. */
export async function fetchOrgInventory(): Promise<LeadInventoryResponse> {
  const r = await fetch(`${ORG_API}/inventory`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as LeadInventoryResponse;
}
