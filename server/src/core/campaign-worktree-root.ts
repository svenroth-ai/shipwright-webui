/*
 * campaign-worktree-root.ts — where a campaign's loop state actually lives.
 *
 * A campaign runs in its OWN worktree, `<main_root>/.worktrees/campaign-<slug>`
 * (monorepo `campaign-worktree.md`), keyed by the campaign slug so a resumed
 * campaign re-enters the same directory. That worktree — not the main root —
 * holds the campaign's `.shipwright/loop_state.json`, and it is the cwd every
 * git call of `loop_claim.py` (batch-base resolution, ancestry asserts) must
 * run in. The main root's own `loop_state.json` is not a worktree campaign's
 * state and is never read for one.
 *
 * Legacy campaigns (no such worktree) fall back to the project root, exactly
 * as they behaved before campaigns got worktrees.
 *
 * Read-only and tolerant: any fs error resolves to the fallback, never throws.
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { isWithin } from "./campaign-paths.js";

const SLUG_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const WORKTREE_PREFIX = "campaign-";

export interface CampaignStateRoot {
  /** Directory holding `.shipwright/loop_state.json` and used as git cwd. */
  root: string;
  /** True when `root` is the campaign's own worktree; false = legacy fallback. */
  worktree: boolean;
}

/** `<root>/.shipwright/loop_state.json`. */
export function loopStatePathFor(root: string): string {
  return path.join(root, ".shipwright", "loop_state.json");
}

/** realpath of a directory under `<projectRoot>/.worktrees`, or null. */
function safeWorktreeDir(projectRoot: string, name: string): string | null {
  try {
    const parent = realpathSync(path.join(projectRoot, ".worktrees"));
    const candidate = path.join(parent, name);
    if (!statSync(candidate).isDirectory()) return null;
    const real = realpathSync(candidate);
    return isWithin(parent, real) && real !== parent ? real : null;
  } catch {
    return null;
  }
}

/**
 * The state root for one campaign: its worktree when present (realpath-guarded
 * inside `<projectRoot>/.worktrees`), else the project root.
 */
export function resolveCampaignStateRoot(projectRoot: string, slug: string): CampaignStateRoot {
  const fallback: CampaignStateRoot = { root: projectRoot, worktree: false };
  if (!SLUG_PATTERN.test(slug) || slug.includes("..")) return fallback;
  const real = safeWorktreeDir(projectRoot, WORKTREE_PREFIX + slug);
  return real ? { root: real, worktree: true } : fallback;
}

/** Every existing campaign worktree under the project, as `{ slug, root }`. */
export function listCampaignWorktrees(projectRoot: string): Array<{ slug: string; root: string }> {
  let entries: string[];
  try {
    entries = readdirSync(path.join(projectRoot, ".worktrees"));
  } catch {
    return [];
  }
  const out: Array<{ slug: string; root: string }> = [];
  for (const name of entries) {
    if (!name.startsWith(WORKTREE_PREFIX)) continue;
    const slug = name.slice(WORKTREE_PREFIX.length);
    if (!slug || !SLUG_PATTERN.test(slug) || slug.includes("..")) continue;
    const real = safeWorktreeDir(projectRoot, name);
    if (real) out.push({ slug, root: real });
  }
  return out;
}
