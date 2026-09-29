/*
 * campaign-loop-state.ts — read-only detector for an ATTACHED autonomous
 * campaign run, derived from the project-root loop-state file.
 *
 * The autonomous campaign loop (shared/scripts/lib/autonomous_loop.py) drives
 * sub-iterates from `<projectRoot>/.shipwright/loop_state.json`:
 *   - `init`   seeds units (status "pending"); `kind: "sub_iterate"` for campaigns.
 *   - `next`   flips the picked unit to "in_progress" + stamps `started_at`.
 *   - `record` flips it to a terminal status (complete/failed/escalated).
 * So a unit sitting at "in_progress" === an orchestrator is attached RIGHT NOW.
 * Each unit's `spec_path` embeds `…/campaigns/<slug>/sub-iterates/…`, which
 * joins the live unit back to its campaign slug.
 *
 * This is the webui's INDEPENDENT attached-run signal — it works today, without
 * the producer-side `status.json` in_progress write (a separate
 * shipwright-monorepo change). `routes/campaigns.ts` unions it with any
 * `status.json` step `in_progress` for defense-in-depth.
 *
 * Tolerant by construction: the 3 s Campaigns poll WILL race a Python write, so
 * a missing / half-written / wrong-kind file resolves to ∅ (nothing attached)
 * rather than throwing.
 */

import { existsSync, readFileSync } from "node:fs";

import { listCampaignWorktrees, loopStatePathFor } from "./campaign-worktree-root.js";

/**
 * A unit `in_progress` for longer than this is a DEAD orchestrator (crashed
 * between `next` and `record`), NOT an attached run — so a crash never pins the
 * launch buttons disabled forever. Real sub-iterates finish in minutes; 6 h is
 * safely above any legitimate run. Override via
 * `SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS` (positive milliseconds).
 */
const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;

function staleWindowMs(): number {
  const raw = process.env.SHIPWRIGHT_CAMPAIGN_ATTACH_STALE_MS;
  if (raw === undefined) return DEFAULT_STALE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_MS;
}

interface LoopUnit {
  id?: unknown;
  status?: unknown;
  spec_path?: unknown;
  started_at?: unknown;
  claimed_at?: unknown;
}

/**
 * Unit statuses that mean an orchestrator/runner currently owns the unit.
 * `in_progress` is the pre-R4 legacy status; the rest are the monorepo's
 * unit state machine (`loop_state.py` — ACTIVE `claimed|running|merging`, plus
 * `built|reviewed`, which sit between a finished build and its merge with the
 * orchestrator still attached). A wave run never writes `in_progress`, so a
 * detector that knew only that status was blind to it.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "in_progress",
  "claimed",
  "running",
  "built",
  "reviewed",
  "merging",
]);

interface LoopState {
  kind?: unknown;
  units?: unknown;
}

/**
 * Extract the campaign slug from a unit `spec_path` of the shape
 * `<…>/campaigns/<slug>/sub-iterates/<…>.md`. Normalises both `/` and `\`
 * (loop_state.json stores backslash paths on Windows). Returns null when the
 * `campaigns/<slug>` segment is absent.
 */
export function campaignSlugFromSpecPath(specPath: string): string | null {
  const parts = specPath.split(/[\\/]+/).filter(Boolean);
  const i = parts.indexOf("campaigns");
  if (i < 0 || i + 1 >= parts.length) return null;
  const slug = parts[i + 1];
  return slug && slug !== ".." ? slug : null;
}

/**
 * True when an `in_progress` unit is still LIVE: its `started_at` is within the
 * stale window. A missing / unparseable `started_at` is treated as live
 * (conservative — `next` always stamps it, so absence is anomalous and we'd
 * rather block a double-launch than allow one; bounded by the next `init`
 * reconcile).
 */
function isLive(startedAt: unknown, nowMs: number, windowMs: number): boolean {
  if (typeof startedAt !== "string" || !startedAt) return true;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t <= windowMs;
}

/**
 * A single, internally-consistent snapshot of the loop-state file's live units:
 *   - `attachedSlugs`        — campaign slugs with ANY live (`in_progress`,
 *     non-stale) unit; the double-launch guard (id-agnostic — a unit needs only
 *     a `spec_path` slug to pin the guard, per ADR / PR #116).
 *   - `runningStepIdsBySlug` — slug → set of live unit `id`s (== campaign step
 *     ids, e.g. `D1`). Drives the per-step board overlay (this iterate). A live
 *     unit without an `id` contributes to `attachedSlugs` but no step id.
 * Both come from ONE read so the guard and the overlay can never disagree on a
 * torn-read boundary. ∅ snapshot when the file is missing, torn, not a
 * `sub_iterate` loop, or has no live unit.
 */
export interface LoopRunState {
  attachedSlugs: Set<string>;
  runningStepIdsBySlug: Map<string, Set<string>>;
}

export function readLoopRunState(
  projectRoot: string,
  nowMs: number,
): LoopRunState {
  const attachedSlugs = new Set<string>();
  const runningStepIdsBySlug = new Map<string, Set<string>>();
  // One wrapper over two mutable collections: every early return yields the
  // still-empty snapshot; the final return yields the populated one.
  const snapshot: LoopRunState = { attachedSlugs, runningStepIdsBySlug };
  const windowMs = staleWindowMs();

  // A campaign with its own worktree keeps its state THERE (the slug is the
  // directory name); the main root's file serves legacy campaigns, whose slug
  // comes from each unit's spec_path.
  const worktreeSlugs = new Set<string>();
  for (const wt of listCampaignWorktrees(projectRoot)) {
    if (existsSync(loopStatePathFor(wt.root))) worktreeSlugs.add(wt.slug);
    collectLive(loopStatePathFor(wt.root), wt.slug, snapshot, nowMs, windowMs);
  }
  // The main root's file is never a worktree campaign's state: units of a slug
  // that owns a worktree are ignored there (a stale root file must not attach it).
  collectLive(loopStatePathFor(projectRoot), null, snapshot, nowMs, windowMs, worktreeSlugs);
  return snapshot;
}

/** Fold one loop-state file's live units into `snapshot`. Tolerant: a missing /
 *  torn / wrong-kind file contributes nothing. `fixedSlug` = the worktree's
 *  campaign; null = derive from each unit's spec_path. */
function collectLive(
  file: string,
  fixedSlug: string | null,
  snapshot: LoopRunState,
  nowMs: number,
  windowMs: number,
  skipSlugs?: ReadonlySet<string>,
): void {
  if (!existsSync(file)) return;
  let state: LoopState;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    state = parsed as LoopState;
  } catch {
    return; // torn / malformed read
  }
  // Only campaign loops (`sub_iterate`) map to the Campaigns lane; a `section`
  // loop is a /shipwright-build run, never a campaign.
  if (state.kind !== "sub_iterate" || !Array.isArray(state.units)) return;

  for (const u of state.units as LoopUnit[]) {
    if (!u || typeof u.status !== "string" || !LIVE_STATUSES.has(u.status)) continue;
    let slug = fixedSlug;
    if (!slug) {
      if (typeof u.spec_path !== "string") continue;
      slug = campaignSlugFromSpecPath(u.spec_path);
    }
    if (!slug || skipSlugs?.has(slug)) continue;
    if (!isLive(u.started_at ?? u.claimed_at, nowMs, windowMs)) continue;
    snapshot.attachedSlugs.add(slug);
    if (typeof u.id === "string" && u.id) {
      let ids = snapshot.runningStepIdsBySlug.get(slug);
      if (!ids) {
        ids = new Set<string>();
        snapshot.runningStepIdsBySlug.set(slug, ids);
      }
      ids.add(u.id);
    }
  }
}

/**
 * Set of campaign slugs that currently have a LIVE sub-iterate unit — i.e. an
 * autonomous orchestrator is attached. Thin wrapper over {@link readLoopRunState}
 * (back-compat: the double-launch guard reads only this projection).
 */
export function readLoopAttachments(
  projectRoot: string,
  nowMs: number,
): Set<string> {
  return readLoopRunState(projectRoot, nowMs).attachedSlugs;
}
