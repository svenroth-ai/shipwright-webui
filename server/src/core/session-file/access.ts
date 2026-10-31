/*
 * Decision core of GET /tasks/:id/session-file: may this task read this path?
 *
 *   project scope — the path lies inside the project root (or the task cwd):
 *     the existing Smart-Viewer posture (pathGuard + realPathGuard, DO-NOT #10);
 *     a symlink that leaves the root is REJECTED, never retried as "session".
 *   session scope — outside the root, but THIS session evidences the path
 *     (core/session-file/evidence.ts), and so its realpath if that differs.
 *
 * The WebUI is reachable over Tailscale: "any file on the machine" would expose
 * ~/.ssh, tokens and .env, hence the evidence rule plus the sensitive-location
 * denylist. Existence is only disclosed AFTER evidence is proven (an unevidenced
 * path answers 403 whether or not it exists). No directory is ever served.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";

import { pathGuard } from "../path-guard.js";
import { evidenceKey } from "./evidence.js";
import { isSensitivePath } from "./sensitive.js";

export interface AccessDenial {
  status: 400 | 403 | 404;
  error: string;
  detail?: string;
}
export type AccessDecision = { ok: true; absolute: string; scope: "project" | "session" } | ({ ok: false } & AccessDenial);

export interface AccessArgs {
  /** Trusted roots: the project root (the task cwd only when the task has no project); existing absolute dirs. */
  roots: string[];
  requested: string;
  /** Subset of `candidates` the session evidences (evidenceKey()s). */
  findEvidence: (candidates: string[]) => Promise<{ found: Set<string>; incomplete: boolean }>;
}

const deny = (status: AccessDenial["status"], error: string, detail?: string): AccessDecision => ({ ok: false, status, error, detail });
export const MAX_PATH_CHARS = 4096;

function lexicallyUnder(root: string, abs: string): boolean {
  if (process.platform === "win32" && root.slice(0, 2).toLowerCase() !== abs.slice(0, 2).toLowerCase()) return false;
  const rel = path.relative(root, abs);
  return !(rel === ".." || rel.startsWith(".." + path.sep) || rel.startsWith("../") || path.isAbsolute(rel));
}

export async function decideSessionFileAccess(args: AccessArgs): Promise<AccessDecision> {
  const { roots, requested } = args;
  if (!requested) return deny(400, "path_required");
  if (requested.length > MAX_PATH_CHARS || requested.includes("\0")) return deny(400, "invalid_path");
  // UNC / device namespaces would reach network shares and raw devices.
  if (process.platform === "win32" ? /^[/\x5c]{2}/.test(requested) : false) return deny(400, "invalid_path", "unc_or_device");
  // A foreign drive-letter path is meaningless on a POSIX host (it would resolve as a relative name).
  if (process.platform !== "win32" && path.win32.isAbsolute(requested)) return deny(400, "invalid_path", "foreign_absolute");

  let absolute: string;
  if (path.isAbsolute(requested)) {
    absolute = path.resolve(requested);
  } else {
    // Only a relative path needs a project root; an absolute one can still be session-evidenced.
    if (roots.length === 0) return deny(400, "project_path_unavailable");
    const g = pathGuard(roots[0]!, requested);
    if (!g.ok) return deny(400, g.reason === "traversal" ? "path_traversal" : g.reason, g.reason);
    absolute = g.absolute;
  }

  const root = roots.find((r) => lexicallyUnder(path.resolve(r), absolute));
  if (root) {
    let real: string;
    try {
      real = await realpath(absolute);
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? deny(404, "not_found") : deny(400, "path_traversal", "symlink_escape");
    }
    // Validate the SAME resolution we return (a second realpath inside a guard could see a swapped link).
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      return deny(400, "path_traversal", "symlink_escape");
    }
    if (!lexicallyUnder(realRoot, real)) return deny(400, "path_traversal", "symlink_escape");
    return { ok: true, absolute: real, scope: "project" };
  }

  // Outside every root: session evidence required. Sensitive locations never qualify.
  if (isSensitivePath(absolute)) return deny(403, "path_not_evidenced", "sensitive");
  let real: string | null = null;
  try {
    real = await realpath(absolute);
  } catch {
    real = null;
  }
  const candidates = real && evidenceKey(real) !== evidenceKey(absolute) ? [absolute, real] : [absolute];
  const { found, incomplete } = await args.findEvidence(candidates);
  if (!found.has(evidenceKey(absolute))) return deny(403, "path_not_evidenced", incomplete ? "evidence_window_truncated" : undefined);
  if (!real) return deny(404, "not_found");
  // A symlink/junction hop: the session must have named where it really leads.
  if (candidates.length === 2 && !found.has(evidenceKey(real))) return deny(403, "path_not_evidenced", "symlink_target");
  // Residual risk (recorded, accepted): a file REPLACED at an evidenced path is served as-is.
  if (isSensitivePath(real)) return deny(403, "path_not_evidenced", "sensitive");
  // The real target might sit inside a root that the lexical path did not (a link INTO the project): fine, still evidenced.
  return { ok: true, absolute: real, scope: "session" };
}
