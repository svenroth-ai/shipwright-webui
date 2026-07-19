/*
 * campaign-events.ts — project Campaigns-board status from the tracked event
 * log, so a campaign whose planning dir is gitignored/local-only (PR #121 /
 * monorepo PR #189) still surfaces progress on a fresh clone / redeploy.
 *
 * The campaigns dir (`campaign.md` + `status.json`) is "local-only operational
 * planning, not durable product artifacts" — gone on a clone. The DURABLE,
 * tracked record is `<projectRoot>/shipwright_events.jsonl`: since S1
 * (shipwright-iterate) every campaign `work_completed` event carries top-level
 * `campaign` + `sub_iterate_id`. This module is the webui-consumer counterpart
 * of `shared/scripts/lib/campaign_status.py::project_campaign_status`
 * (ADR-121 family, campaign `2026-06-07-tracked-campaign-status`):
 *
 *   - `projectCampaignEvents` — pure `_project_events` parity: latest
 *     `work_completed` per (campaign, sub_iterate_id) wins.
 *   - `applyEventsProjection` — two modes against the dir-sourced campaigns:
 *       1. OVERLAY (dir present): never-downgrade a step to `complete` when an
 *          event confirms it; prefer a non-empty event commit. Corrects a stale
 *          `status.json` (the `done==total` bug class, reported 2026-06-05).
 *       2. SYNTHESIZE (dir absent): build a `derivedFromEvents` Campaign from the
 *          completed sub-iterates alone — no skeleton, so no titles/order/total/
 *          pending; `specPath` null (launch CTAs disable).
 *
 * Read-only: webui never writes events.jsonl (Architecture rule 1).
 */

import { recordsFromLines } from "./jsonl-records.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Campaign, CampaignStep } from "./campaign-store.js";

/** Per-tree, version-controlled event log (parity with events_log.EVENT_FILE). */
const EVENT_FILE = "shipwright_events.jsonl";

export interface SubEventProjection {
  /** Commit sha from the latest matching `work_completed` event, or null when
   *  it carried none (a worktree F5b event is written with `commit==""`). Tests
   *  are intentionally NOT projected — the board renders no test column. */
  commit: string | null;
}

/** slug → (sub_iterate_id → projection of its latest `work_completed` event). */
export type CampaignEventsProjection = Map<string, Map<string, SubEventProjection>>;

interface Best {
  key: number; // ts epoch ms; -Infinity when unparseable (file index breaks ties)
  idx: number; // file line index — strictly increasing, the last-write tiebreak
  commit: string | null;
}

function tsEpoch(ts: unknown): number {
  if (typeof ts !== "string" || !ts) return -Infinity;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Pure projection of campaign sub-iterate completions from event-log lines.
 * Parity with `campaign_status.py::_project_events`: keep only
 * `type === "work_completed"` events that carry a truthy top-level `campaign`
 * AND `sub_iterate_id`; the latest event per (campaign, sub_iterate_id) wins,
 * ranked by `ts` epoch then file index (a missing/unparseable `ts` sorts
 * oldest, so a later log line still wins). Corrupt / non-object / blank lines
 * are skipped (tolerant — a torn 3 s-poll read must never throw).
 */
export function projectCampaignEvents(
  lines: Iterable<string>,
): CampaignEventsProjection {
  const best = new Map<string, Map<string, Best>>();
  let idx = 0;
  // RECOVERS concatenated records (iterate-2026-07-19-events-reader-recovery).
  // This projection had NO corruption side channel at all, and the consequence
  // was visible product behaviour: `applyEventsProjection` never downgrades, so
  // a dropped `work_completed` leaves a finished sub-iterate rendering as
  // `pending` forever. Recovery is the fix; the silence is left as-is on purpose
  // (the reporting boundary for events is `event-log-reader`, not here).
  for (const o of recordsFromLines(lines)) {
    const i = idx++;
    if (o.type !== "work_completed") continue;
    if (typeof o.campaign !== "string" || !o.campaign) continue;
    if (typeof o.sub_iterate_id !== "string" || !o.sub_iterate_id) continue;

    const key = tsEpoch(o.ts);
    let bySid = best.get(o.campaign);
    if (!bySid) {
      bySid = new Map<string, Best>();
      best.set(o.campaign, bySid);
    }
    const prev = bySid.get(o.sub_iterate_id);
    // Later (key, idx) wins. idx is strictly increasing, so an equal-key later
    // line always supersedes; an earlier/lower-key line is skipped.
    if (prev && key < prev.key) continue;
    if (prev && key === prev.key && i <= prev.idx) continue;
    bySid.set(o.sub_iterate_id, {
      key,
      idx: i,
      commit: typeof o.commit === "string" ? o.commit : null,
    });
  }
  // Strip the sort metadata — callers get only the projection.
  const out: CampaignEventsProjection = new Map();
  for (const [slug, bySid] of best) {
    const clean = new Map<string, SubEventProjection>();
    for (const [sid, b] of bySid) clean.set(sid, { commit: b.commit });
    out.set(slug, clean);
  }
  return out;
}

/**
 * File-loading wrapper: read `<projectRoot>/shipwright_events.jsonl` (the
 * canonical per-tree log, `events_log.resolve_events_path`) and project it.
 * Missing / unreadable log → empty projection (the board falls back to the
 * dir-sourced campaigns, or shows nothing — never an error).
 */
export function readCampaignEvents(projectRoot: string): CampaignEventsProjection {
  const p = path.join(projectRoot, EVENT_FILE);
  if (!existsSync(p)) return new Map();
  let text: string;
  try {
    text = readFileSync(p, "utf-8");
  } catch {
    return new Map();
  }
  return projectCampaignEvents(text.split("\n"));
}

function recomputeProgress(c: Campaign): void {
  c.done = c.steps.filter((s) => s.status === "complete").length;
  const next = c.steps.find((s) => s.status !== "complete") ?? null;
  c.nextPending = next ? { id: next.id, specPath: next.specPath } : null;
}

/** Build a skeleton-less campaign from its completed sub-iterates alone. */
function synthesizeCampaign(
  slug: string,
  subs: Map<string, SubEventProjection>,
): Campaign {
  const steps: CampaignStep[] = [...subs.entries()]
    .map(([id, p]): CampaignStep => ({
      id,
      slug: "",
      title: id, // no skeleton → the id is the only label we have
      status: "complete",
      // Reconstructed from the event log, which records only COMPLETED units.
      statusSource: "events",
      specPath: null, // no skeleton file on a clone → launch CTAs disable
      commit: p.commit || null,
      branch: null,
      planFirst: false,
    }))
    // Numeric-aware id order (C2 before C10); events carry no canonical order.
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    slug,
    intent: "",
    branchStrategy: null,
    expandsTriage: null,
    status: null,
    // Reconstructed from the event log, not read from a campaign directory.
    // Not `degraded`: nothing failed — the records simply are not on this clone.
    provenance: {
      statusSource: "events",
      degraded: false,
      // No campaign directory was consulted, so neither file has a state.
      statusJsonState: "absent",
      campaignMdUnreadable: false,
    },
    steps,
    done: steps.length,
    total: steps.length,
    nextPending: null,
    derivedFromEvents: true,
  };
}

/**
 * Merge the events projection into the dir-sourced campaigns:
 *   1. OVERLAY each locally-present campaign — never-downgrade a step to
 *      `complete` when an event confirms it, prefer a non-empty event commit,
 *      then recompute `done`/`nextPending` (`total` is the skeleton, unchanged).
 *   2. SYNTHESIZE a `derivedFromEvents` campaign for every event-only slug.
 * Returns locals + synthesized, sorted by slug descending (newest-first, like
 * `readCampaigns`). `merge_status(committed, "complete")` is always `"complete"`
 * — including over `failed`/`escalated` (a re-run that emitted a fresh event) —
 * so the overlay is a single status set.
 */
export function applyEventsProjection(
  campaigns: Campaign[],
  projection: CampaignEventsProjection,
): Campaign[] {
  const localSlugs = new Set(campaigns.map((c) => c.slug));

  for (const c of campaigns) {
    const subs = projection.get(c.slug);
    if (!subs) continue;
    for (const step of c.steps) {
      const p = subs.get(step.id);
      if (!p) continue; // no event → untouched (never downgrade)
      step.status = "complete";
      if (p.commit) step.commit = p.commit;
    }
    recomputeProgress(c);
  }

  const synthesized: Campaign[] = [];
  for (const [slug, subs] of projection) {
    if (localSlugs.has(slug) || subs.size === 0) continue;
    synthesized.push(synthesizeCampaign(slug, subs));
  }

  const all = [...campaigns, ...synthesized];
  all.sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
  return all;
}
