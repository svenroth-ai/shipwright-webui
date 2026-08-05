/*
 * triage-contract.ts — TS port of `shared/scripts/lib/triage_contract.py`,
 * the shape of the monorepo's `triage_cli.py list --json` output.
 *
 * NOT the live WebUI `GET /api/triage/:projectId` wire shape (that stays
 * `{items, origin}`, additive fields only — see the spec's Technical
 * Approach for why). This module exists so the WebUI's understanding of the
 * monorepo's cross-repo CLI contract stays provably in sync — the parity
 * gate in `triage-contract.test.ts` compares its output byte-for-byte
 * against a fixture regenerated from the REAL `triage_cli.py`.
 */

import type { TriageItem } from "../types/triage.js";
import { sortDeferred } from "./triage-defer.js";
import { enrichPendingDelivery } from "./triage-enrich.js";
import { filterTriage } from "./triage-store.js";

/** Bump when the SHAPE changes — not when an item gains a field. Mirrors triage_contract.py. */
export const CONTRACT_VERSION = 2;

export interface TriageListing {
  contractVersion: number;
  open: TriageItem[];
  deferred: TriageItem[];
}

/**
 * The full `list --json` payload for a resolved view. `open` = status ===
 * "triage"; `deferred` = status === "snoozed" (park-expiry already resolved
 * by `applyDeferOverlay` inside `readAllItems`, so a due park is already in
 * `open` by the time this runs). Both sections are COMPLETE — never capped,
 * mirroring upstream's "the machine contract is never capped" rule.
 * `deferred` is ordered by `sortDeferred` (soonest dated first).
 */
export function buildTriageListing(
  items: TriageItem[],
  trackedPath: string,
): TriageListing {
  const open = filterTriage(items).map((it) => ({ ...it }));
  const deferred = items
    .filter((it) => it.status === "snoozed")
    .map((it) => ({ ...it }));
  enrichPendingDelivery(open, trackedPath);
  enrichPendingDelivery(deferred, trackedPath);
  const severityRank: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return {
    contractVersion: CONTRACT_VERSION,
    open,
    deferred: sortDeferred(deferred, severityRank),
  };
}
