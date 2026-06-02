/*
 * campaign-paths.ts — centralized resolver for a project's campaigns dir
 * `<project>/.shipwright/planning/iterate/campaigns`.
 *
 * Sibling of `triage-paths.ts` (ADR-101): same realpath + path.relative
 * containment semantics so a symlinked `.shipwright` (or any ancestor)
 * pointing outside the project can't redirect reads. The campaigns dir is
 * four segments deep and frequently does not exist yet, so the "not present"
 * case is a normal `{ ok:true, existed:false }` result — the route turns that
 * into `200 { campaigns: [] }`, NOT a 404 (404 is reserved for unknown /
 * synthesized project ids).
 *
 * Returns the realpath-resolved campaigns dir when it exists; otherwise the
 * static candidate path after verifying the nearest existing ancestor is
 * within the (realpath-resolved) project root.
 */

import path from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";

export type CampaignsPathError = {
  reason:
    | "missing_project_path"
    | "synthesized_project"
    | "path_traversal"
    | "project_root_not_directory";
};

export type CampaignsPathResult =
  | { ok: true; absolute: string; projectRoot: string; existed: boolean }
  | { ok: false; error: CampaignsPathError };

export interface CampaignsPathProject {
  path: string;
  synthesized?: boolean;
}

/** `.shipwright/planning/iterate/campaigns` — constant, no user input. */
const SUBDIR_SEGMENTS = [
  ".shipwright",
  "planning",
  "iterate",
  "campaigns",
] as const;

export function resolveCampaignsDir(
  project: CampaignsPathProject,
): CampaignsPathResult {
  if (project.synthesized) {
    return { ok: false, error: { reason: "synthesized_project" } };
  }
  if (!project.path || typeof project.path !== "string") {
    return { ok: false, error: { reason: "missing_project_path" } };
  }

  // Resolve project.path to its realpath when it exists; fall through to the
  // literal resolve otherwise (the candidate is still emitted — readCampaigns
  // returns [] for a non-existent dir).
  let projectRoot: string;
  try {
    projectRoot = realpathSync(project.path);
  } catch {
    projectRoot = path.resolve(project.path);
  }

  try {
    const st = statSync(projectRoot);
    if (!st.isDirectory()) {
      return { ok: false, error: { reason: "project_root_not_directory" } };
    }
  } catch {
    // Project root doesn't exist — emit the candidate; the store reads [].
    const candidate = path.join(projectRoot, ...SUBDIR_SEGMENTS);
    return { ok: true, absolute: candidate, projectRoot, existed: false };
  }

  const candidate = path.resolve(projectRoot, ...SUBDIR_SEGMENTS);

  // Dir exists → realpath it (defeats a symlinked ancestor) + verify within.
  if (existsSync(candidate)) {
    let resolved: string;
    try {
      resolved = realpathSync(candidate);
    } catch {
      return { ok: false, error: { reason: "path_traversal" } };
    }
    if (!isWithin(projectRoot, resolved)) {
      return { ok: false, error: { reason: "path_traversal" } };
    }
    return { ok: true, absolute: resolved, projectRoot, existed: true };
  }

  // Dir doesn't exist — walk up to the nearest EXISTING ancestor and verify
  // it stays within the project root (a symlinked `.shipwright` pointing
  // outside is the escape vector this guards).
  let ancestor = path.dirname(candidate);
  while (
    ancestor &&
    ancestor !== path.dirname(ancestor) &&
    !existsSync(ancestor)
  ) {
    ancestor = path.dirname(ancestor);
  }
  if (existsSync(ancestor)) {
    let resolvedAncestor: string;
    try {
      resolvedAncestor = realpathSync(ancestor);
    } catch {
      return { ok: false, error: { reason: "path_traversal" } };
    }
    if (!isWithin(projectRoot, resolvedAncestor)) {
      return { ok: false, error: { reason: "path_traversal" } };
    }
  }
  return { ok: true, absolute: candidate, projectRoot, existed: false };
}

/**
 * True when `candidate` is `projectRoot` itself or a descendant of it.
 * Exported so `campaign-store.ts` shares the single containment SSoT for its
 * per-step spec-file symlink-escape guard.
 */
export function isWithin(projectRoot: string, candidate: string): boolean {
  const rel = path.relative(projectRoot, candidate);
  if (!rel) return true; // exact match — root itself
  if (path.isAbsolute(rel)) return false; // different drive / root
  // Reject only a genuine upward escape — a leading ".." SEGMENT — so a real
  // descendant directory literally named "..safe" is not falsely rejected
  // (external code review). Mirrors core/path-guard.ts.
  if (rel === ".." || rel.startsWith(".." + path.sep) || rel.startsWith("../")) {
    return false;
  }
  return true;
}
