/*
 * triage-enrich.ts — GET-route enrichment layer over the resolved triage
 * view. Two deliberately separate concerns (external review OAI11):
 *
 *   enrichPendingDelivery — TRACKED-PREFERRED outbox residence flag,
 *     mirroring the monorepo `triage_cli.py list --json` contract
 *     (shipwright PR #177, trg-e2a0ebb3). Python layering parallel:
 *     `read_all_items()` never emits the field — only the CLI list
 *     surface adds it — so it must NOT live in `readAllItems()` (whose
 *     output is parity-tested byte-for-byte against `read_all_items`).
 *
 *   enrichWithCampaignRefs — FR-01.33 campaign correlation, moved
 *     verbatim from routes/triage.ts (anti-ratchet extraction,
 *     iterate-2026-06-10-triage-pending-delivery-badge). Consumes only
 *     the injected ref list, so the campaigns-no-triage-coupling import
 *     boundary is preserved: this module imports no campaign code.
 *
 * Neither function is part of the `readAllItems` parity surface; both are
 * per-request annotations that never persist to triage.jsonl.
 */

import type { TriageItem } from "../types/triage.js";
import { appendIdsInFile } from "./triage-store.js";
import { outboxPathFor } from "./triage-paths.js";
import { statSync } from "node:fs";

// ---------------------------------------------------------------------------
// pendingDelivery (outbox residence)
// ---------------------------------------------------------------------------

interface ResidenceEntry {
  trackedMtimeMs: number | null;
  outboxMtimeMs: number | null;
  filledAt: number;
  trackedIds: Set<string>;
  outboxIds: Set<string>;
}

const RESIDENCE_TTL_MS = 5_000;
const residenceCache = new Map<string, ResidenceEntry>();

/** Test-only — clear the residence memo. */
export function _clearEnrichCache_TEST_ONLY(): void {
  residenceCache.clear();
}

function mtimeOrNull(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Append-id residence sets for a project's tracked + outbox pair, memoized
 * by both mtimes (5 s soft TTL, same shape as the triage-store cache) so a
 * polling GET costs two stat() calls, not two file parses (external review
 * OAI4/Gem1). The residence key is the triage item id (`trg-…`) of `append`
 * events — identical to Python `_append_ids_at` (OAI2/Gem4). A missing file
 * yields an empty set via `appendIdsInFile`'s tolerant reader (OAI7/Gem2).
 *
 * Deliberately NOT evicted by triage-write's `invalidateCacheForPath`: WebUI
 * writes are exclusively `status` events, which never change append-id sets
 * (and the write bumps the file mtime anyway, which misses this memo on the
 * next call). Do not "fix" the asymmetry.
 */
function residenceSets(trackedPath: string): ResidenceEntry {
  const outboxPath = outboxPathFor(trackedPath);
  const trackedMtimeMs = mtimeOrNull(trackedPath);
  const outboxMtimeMs = mtimeOrNull(outboxPath);
  const cached = residenceCache.get(trackedPath);
  if (
    cached &&
    cached.trackedMtimeMs === trackedMtimeMs &&
    cached.outboxMtimeMs === outboxMtimeMs &&
    Date.now() - cached.filledAt < RESIDENCE_TTL_MS
  ) {
    return cached;
  }
  const entry: ResidenceEntry = {
    trackedMtimeMs,
    outboxMtimeMs,
    filledAt: Date.now(),
    trackedIds: appendIdsInFile(trackedPath),
    outboxIds: appendIdsInFile(outboxPath),
  };
  residenceCache.set(trackedPath, entry);
  return entry;
}

/**
 * Annotate every item with a CONCRETE `pendingDelivery` boolean (never
 * undefined — external review OAI1): `true` iff the item's `append` lives
 * ONLY in the gitignored per-tree outbox buffer, i.e. it has not yet been
 * swept into the tracked log and "ships with the next iterate" PR.
 * TRACKED-PREFERRED: an id present in BOTH files (post-sweep, pre-GC) is
 * NOT pending — parallels `triage.mark_status` residence derivation.
 * Status-independent by design (OAI9): closed items get the flag too; the
 * inbox UI only renders open items.
 */
export function enrichPendingDelivery(
  items: TriageItem[],
  trackedPath: string,
): void {
  const { trackedIds, outboxIds } = residenceSets(trackedPath);
  for (const it of items) {
    it.pendingDelivery = outboxIds.has(it.id) && !trackedIds.has(it.id);
  }
}

// ---------------------------------------------------------------------------
// Campaign correlation (FR-01.33) — moved verbatim from routes/triage.ts
// ---------------------------------------------------------------------------

/** Injected campaign correlation ref (shape owned by the route deps). */
export interface CampaignRef {
  expandsTriage: string | null;
  slug: string;
  status: "draft" | "active" | "complete" | null;
}

/**
 * FR-01.33 — annotate triage items with the campaign that expands them
 * (campaignSlug + campaignStatus). Server-side join via the injected
 * `listCampaignRefs` dep so the route module imports no campaign code
 * (preserves the campaigns-no-triage-coupling boundary). Best-effort — a
 * thrown dep never fails the triage list. Deterministic when multiple
 * campaigns share an `expandsTriage`: prefer draft, then active, then
 * first seen.
 */
export function enrichWithCampaignRefs(
  items: TriageItem[],
  projectId: string,
  listCampaignRefs: ((projectId: string) => CampaignRef[]) | undefined,
): void {
  if (!listCampaignRefs) return;
  let refs: CampaignRef[];
  try {
    refs = listCampaignRefs(projectId);
  } catch {
    return;
  }
  if (!refs.length) return;
  const rank = (s: string | null): number =>
    s === "draft" ? 0 : s === "active" ? 1 : 2;
  const byTriage = new Map<
    string,
    { slug: string; status: "draft" | "active" | "complete" | null }
  >();
  for (const r of refs) {
    if (!r.expandsTriage) continue;
    const existing = byTriage.get(r.expandsTriage);
    if (!existing || rank(r.status) < rank(existing.status)) {
      byTriage.set(r.expandsTriage, { slug: r.slug, status: r.status });
    }
  }
  for (const it of items) {
    const ref = byTriage.get(it.id);
    if (ref) {
      it.campaignSlug = ref.slug;
      it.campaignStatus = ref.status;
    }
  }
}
