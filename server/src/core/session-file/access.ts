/*
 * Decision core of GET /tasks/:id/session-file: may this task read this path?
 *
 *   project scope — the path lies inside the REGISTERED project root (the client-supplied task cwd is never a root):
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

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { pathGuard, realPathGuard } from "../path-guard.js";
import { evidenceKey } from "./evidence.js";
import { isSensitivePath } from "./sensitive.js";

export interface AccessDenial {
  status: 400 | 403 | 404;
  error: string;
  detail?: string;
}
export type AccessDecision = { ok: true; absolute: string; scope: "project" | "session" } | ({ ok: false } & AccessDenial);

export interface AccessArgs {
  /** Trusted roots: the registered project root only (may be empty); existing absolute dirs. */
  roots: string[];
  requested: string;
  /** Subset of `candidates` the session evidences (evidenceKey()s). */
  findEvidence: (candidates: string[]) => Promise<{ found: Set<string>; incomplete: boolean }>;
}

const deny = (status: AccessDenial["status"], error: string, detail?: string): AccessDecision => ({ ok: false, status, error, detail });
export const MAX_PATH_CHARS = 4096;

/**
 * The registered root that lexically contains `abs`, decided by the shared pathGuard (DO-NOT #10) on the
 * root-relative form: a sibling prefix, `..` hop, other drive (or UNC) all come back !ok. Selection only; the
 * authorising check is realPathGuard below.
 */
function containingRoot(roots: string[], abs: string): string | undefined {
  return roots.find((r) => pathGuard(r, path.relative(path.resolve(r), abs)).ok);
}

/**
 * The guard folds "missing" into symlink_escape. 404 only when the deepest EXISTING ancestor still lies inside the
 * root; a path that hops out through a link answers 400 whether or not its target exists (no existence oracle
 * outside the project, not even through a dangling link).
 */
async function classifyProjectMiss(root: string, realRoot: string, absolute: string): Promise<AccessDecision> {
  let probe = absolute;
  for (;;) {
    try {
      const real = await realpath(probe);
      return realPathGuard(root, real, realRoot).ok ? deny(404, "not_found") : deny(400, "path_traversal", "symlink_escape");
    } catch (err) {
      // A dangling link (leaf or ancestor) points somewhere we must not describe: treat it as an escape.
      if (await lstat(probe).then((st) => st.isSymbolicLink(), () => false)) return deny(400, "path_traversal", "symlink_escape");
      const parent = path.dirname(probe);
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT" || parent === probe) return deny(400, "path_traversal", "symlink_escape");
      probe = parent;
    }
  }
}

export async function decideSessionFileAccess(args: AccessArgs): Promise<AccessDecision> {
  const { roots, requested } = args;
  if (!requested) return deny(400, "path_required");
  if (requested.length > MAX_PATH_CHARS || requested.includes("\0")) return deny(400, "invalid_path");
  // UNC / device namespaces would reach network shares and raw devices.
  if (process.platform === "win32" && /^[/\x5c]{2}/.test(requested)) return deny(400, "invalid_path", "unc_or_device");
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

  const root = containingRoot(roots, absolute);
  if (root) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      return deny(400, "path_traversal", "symlink_escape");
    }
    // The shared symlink-aware guard (DO-NOT #10, not a re-implementation), validated against the same realRoot.
    if (!realPathGuard(root, absolute, realRoot).ok) return classifyProjectMiss(root, realRoot, absolute);
    // realPathGuard resolves with the JS realpath (keeps input casing / 8.3 names); safe-read compares against the
    // NATIVE one. Serve - and run the credential denylist on - the native canonical name, and re-apply the shared
    // guard to it, so every spelling of a file (case, 8.3, trailing dot) is judged as the file it really is.
    let canon: string;
    try {
      canon = await realpath(absolute);
    } catch {
      return classifyProjectMiss(root, realRoot, absolute);
    }
    if (!realPathGuard(root, canon, realRoot).ok) return deny(400, "path_traversal", "symlink_escape");
    // Unmistakable secret names stay refused even inside a (possibly broad) project root; ordinary project files are untouched.
    const relInRoot = path.relative(realRoot, canon);
    if (relInRoot !== "" && isSensitivePath(relInRoot, "project")) return deny(403, "sensitive_location");
    return { ok: true, absolute: canon, scope: "project" };
  }

  // Outside every root: session evidence required. Sensitive locations never qualify.
  if (isSensitivePath(absolute)) return deny(403, "sensitive_location");
  // Evidence FIRST: an unevidenced path never reaches the filesystem (no network-drive touch, no timing oracle).
  const first = await args.findEvidence([absolute]);
  if (!first.found.has(evidenceKey(absolute))) {
    return deny(403, "path_not_evidenced", first.incomplete ? "evidence_window_truncated" : undefined);
  }
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    return deny(404, "not_found");
  }
  // A symlink/junction hop: the session must have named where it really leads.
  if (evidenceKey(real) !== evidenceKey(absolute)) {
    const hop = await args.findEvidence([real]);
    if (!hop.found.has(evidenceKey(real))) return deny(403, "path_not_evidenced", "symlink_target");
  }
  // Residual risk (recorded, accepted): a file REPLACED at an evidenced path is served as-is.
  if (isSensitivePath(real)) return deny(403, "sensitive_location");
  // The real target might sit inside a root that the lexical path did not (a link INTO the project): fine, still evidenced.
  return { ok: true, absolute: real, scope: "session" };
}
