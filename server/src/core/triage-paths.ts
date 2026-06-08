/*
 * triage-paths.ts — centralized resolver for `<project>/.shipwright/triage.jsonl`.
 *
 * Reuses the existing `pathGuard` semantics (realpath + path.relative) so
 * symlinks pointing outside the project can't redirect reads/writes
 * (mirrors the gitignore + tree route protection from ADR-044). Every
 * triage endpoint MUST flow through this helper — read OR write.
 *
 * Returned absolute path is realpath-resolved when the file exists; for
 * the "file doesn't exist yet" case (first triage write on a project)
 * we resolve the parent .shipwright directory and append the static
 * filename, which is safe because path resolution can't escape an
 * already-validated parent.
 */

import path from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";

export type TriagePathError = {
  reason:
    | "missing_project_path"
    | "synthesized_project"
    | "path_traversal"
    | "project_root_not_directory";
};

export type TriagePathResult =
  | { ok: true; absolute: string; existed: boolean }
  | { ok: false; error: TriagePathError };

const SUBDIR = ".shipwright";
const FILENAME = "triage.jsonl";
/**
 * Per-tree, GITIGNORED background-triage buffer (campaign
 * 2026-06-08-triage-outbox-delivery / D1). Idle-main background producers
 * append HERE instead of the tracked `triage.jsonl`; the webui reads the
 * union (tracked ∪ outbox) so those findings stay visible in the live
 * Inbox without waiting for the sweep+merge round-trip. Mirrors
 * `shared/scripts/triage.py OUTBOX_FILE`.
 */
const OUTBOX_FILENAME = "triage.outbox.jsonl";

export interface TriagePathProject {
  path: string;
  synthesized?: boolean;
}

/**
 * Derive the per-tree outbox path that sits alongside an already-resolved
 * tracked `triage.jsonl` path. The outbox lives in the SAME `.shipwright`
 * directory that `resolveTriagePath` already realpath-guarded, so it
 * inherits that traversal protection — there is no new path-guard surface.
 * Pass the `absolute` from a successful `resolveTriagePath` result.
 */
export function outboxPathFor(trackedAbsolute: string): string {
  return path.join(path.dirname(trackedAbsolute), OUTBOX_FILENAME);
}

export function resolveTriagePath(project: TriagePathProject): TriagePathResult {
  if (project.synthesized) {
    return { ok: false, error: { reason: "synthesized_project" } };
  }
  if (!project.path || typeof project.path !== "string") {
    return { ok: false, error: { reason: "missing_project_path" } };
  }

  // Resolve project.path to its realpath (if it exists). Fall through to
  // the literal value if the directory doesn't exist (caller will 404
  // separately).
  let projectRoot: string;
  try {
    projectRoot = realpathSync(project.path);
  } catch {
    projectRoot = path.resolve(project.path);
  }

  // Refuse non-directory project roots — defense in depth against an
  // operator who registered a file path by mistake.
  try {
    const st = statSync(projectRoot);
    if (!st.isDirectory()) {
      return { ok: false, error: { reason: "project_root_not_directory" } };
    }
  } catch {
    // Project root doesn't exist — let the route layer return 404.
    // We still emit the candidate path so the route can decide.
    const candidate = path.join(projectRoot, SUBDIR, FILENAME);
    return { ok: true, absolute: candidate, existed: false };
  }

  const candidate = path.resolve(projectRoot, SUBDIR, FILENAME);

  // realpath the candidate when it exists to defeat symlink redirect.
  // When it doesn't exist yet, we realpath the parent directory and
  // re-append the filename — the only way an attacker can escape from
  // a non-existent file is via the parent .shipwright dir, which we
  // guard separately.
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
    return { ok: true, absolute: resolved, existed: true };
  }

  // File doesn't exist — verify the parent dir (if it exists) is within
  // project root.
  const parent = path.dirname(candidate);
  if (existsSync(parent)) {
    let resolvedParent: string;
    try {
      resolvedParent = realpathSync(parent);
    } catch {
      return { ok: false, error: { reason: "path_traversal" } };
    }
    if (!isWithin(projectRoot, resolvedParent)) {
      return { ok: false, error: { reason: "path_traversal" } };
    }
    return {
      ok: true,
      absolute: path.join(resolvedParent, FILENAME),
      existed: false,
    };
  }
  // Parent .shipwright doesn't exist either — caller decides whether to
  // mkdir. Return the static candidate.
  return { ok: true, absolute: candidate, existed: false };
}

function isWithin(projectRoot: string, candidate: string): boolean {
  const rel = path.relative(projectRoot, candidate);
  if (!rel) return true; // exact match — root itself
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  // segment-wise check: rejects e.g. "..foo" only when the leading ".."
  // is its own segment (path.relative doesn't produce that, but defense
  // in depth).
  return true;
}
