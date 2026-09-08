/*
 * routes/org-inventory-composite.ts — builds the `GET /api/org/inventory`
 * response body (iterate-2026-09-08-lead-inventory-page). One roster-wide
 * composite, mirroring `org-threads-composite.ts` exactly: one
 * `org-chart.json` parse for every lead (done by the caller, `routes/
 * org.ts`), `audit.jsonl` read once per lead (not once per beat), beats
 * bounded to a 48h server-side window instead of a lead's whole register
 * history (Internal Plan Review finding #3 — an unbounded read scales with
 * a lead's entire lifetime register plus every one of those beats'
 * `steps.jsonl`).
 *
 * A per-figure read failure degrades that figure ALONE — `{status:
 * "unreadable"}` for one beat's steps, `{status:"unknown"}` for the whole
 * lead's audit lookup, `{measured:false}` for the authority panel — never
 * collapsed into a false-positive "clear" and never failing the whole lead
 * or the whole roster response.
 */

import { registerPathFor, readRegisterFileTolerant, type LstatFn } from "../external/org/beat-register.js";
import { readBeatEffectAuditCore, type BeatEffectAuditDeps } from "../external/org/beat-effect-audit-read.js";
import { readBeatStepsCore, type BeatStepsReadDeps } from "../external/org/beat-steps-read.js";
import { charterAuthorityCore, type CharterAuthorityDeps } from "../external/org/charter-authority-read.js";
import type { BeatInventoryView, LeadInventoryEntry, LeadInventoryResponse } from "../types/org-inventory.js";

const WINDOW_MS = 48 * 60 * 60 * 1000;

export interface OrgInventoryBuildDeps
  extends BeatEffectAuditDeps,
    BeatStepsReadDeps,
    CharterAuthorityDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
  now?: () => Date;
}

function parsedOrInfinity(startedAt: string): number {
  const ms = Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** One lead's inventory entry — the whole roster-wide composite is just this
 *  called once per chart lead (see `buildOrgInventory` below). */
export function buildLeadInventoryEntry(
  deps: OrgInventoryBuildDeps,
  leadId: string,
  charterPath: string | undefined,
): LeadInventoryEntry {
  const now = deps.now ?? (() => new Date());
  const windowStartMs = now().getTime() - WINDOW_MS;

  const registerRead = readRegisterFileTolerant(registerPathFor(deps.leadsRoot, leadId));
  const allEntries = registerRead.ok ? registerRead.file.entries : [];
  const totalBeatsInRegister = allEntries.length;

  // Bounded window: an unparseable `startedAt` VALUE is INCLUDED rather
  // than dropped (fail toward showing more, never toward hiding data —
  // Internal Plan Review finding #8 / AC-7). The register schema always
  // carries `startedAt` as a string field (`BeatRegisterEntryView`) — what
  // can go wrong is the CONTENT of that string, not its presence.
  const boundedEntries = allEntries
    .filter((e) => {
      const ms = Date.parse(e.startedAt);
      return !Number.isFinite(ms) || ms >= windowStartMs;
    })
    .slice()
    .sort((a, b) => parsedOrInfinity(a.startedAt) - parsedOrInfinity(b.startedAt));

  const auditResult = readBeatEffectAuditCore(deps, leadId, windowStartMs);

  const beats: BeatInventoryView[] = boundedEntries.map((entry) => {
    const steps = readBeatStepsCore(deps, leadId, entry.beatId);
    const unclaimedEffect: BeatInventoryView["unclaimedEffect"] =
      auditResult.status === "unknown"
        ? { status: "unknown" }
        : { status: auditResult.unclaimedBeatIds.has(entry.beatId) ? "found" : "clear" };
    return {
      beatId: entry.beatId,
      startedAt: entry.startedAt,
      closedAt: entry.closedAt,
      steps,
      unclaimedEffect,
    };
  });

  const authority = charterAuthorityCore(deps, leadId, charterPath);

  return { leadId, totalBeatsInRegister, beats, authority };
}

/** Every chart lead's inventory, keyed by leadId — one entry per lead,
 *  always (mirrors `buildOrgThreads`). */
export function buildOrgInventory(
  deps: OrgInventoryBuildDeps,
  leads: Array<{ leadId: string; charterPath: string | undefined }>,
): LeadInventoryResponse {
  const out: LeadInventoryResponse = {};
  for (const { leadId, charterPath } of leads) {
    out[leadId] = buildLeadInventoryEntry(deps, leadId, charterPath);
  }
  return out;
}
