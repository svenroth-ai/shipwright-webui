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
import path from "node:path";

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
  status?: unknown;
  spec_path?: unknown;
  started_at?: unknown;
}

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
 * Read `<projectRoot>/.shipwright/loop_state.json` and return the set of
 * campaign slugs that currently have a LIVE (`in_progress`, non-stale)
 * sub-iterate unit — i.e. an autonomous orchestrator is attached. ∅ when the
 * file is missing, torn, not a `sub_iterate` loop, or has no live unit.
 */
export function readLoopAttachments(
  projectRoot: string,
  nowMs: number,
): Set<string> {
  const out = new Set<string>();
  const p = path.join(projectRoot, ".shipwright", "loop_state.json");
  if (!existsSync(p)) return out;

  let state: LoopState;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return out;
    }
    state = parsed as LoopState;
  } catch {
    return out; // torn / malformed read
  }

  // Only campaign loops (`sub_iterate`) map to the Campaigns lane; a `section`
  // loop is a /shipwright-build run, never a campaign.
  if (state.kind !== "sub_iterate" || !Array.isArray(state.units)) return out;

  const windowMs = staleWindowMs();
  for (const u of state.units as LoopUnit[]) {
    if (!u || u.status !== "in_progress") continue;
    if (typeof u.spec_path !== "string") continue;
    if (!isLive(u.started_at, nowMs, windowMs)) continue;
    const slug = campaignSlugFromSpecPath(u.spec_path);
    if (slug) out.add(slug);
  }
  return out;
}
