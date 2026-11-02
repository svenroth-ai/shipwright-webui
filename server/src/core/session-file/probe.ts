/*
 * Batched "can this path be opened?" probe behind POST /tasks/:id/session-file/probe.
 *
 * The verdict comes from the SAME decision core as the read route (decideSessionFileAccess: realpath
 * path-guard inside the project root, session evidence outside it, sensitive-location denylist) plus a
 * handle-based regular-file check. It answers yes/no and a coarse reason ONLY: never content, never a
 * listing, and a path the session may not see (unevidenced, sensitive, traversal, symlink escape) is
 * reported as the generic "unavailable" so the probe is no existence oracle beyond the read route.
 * Read-only (DO-NOT #1); stateless (rule 4): nothing is remembered between calls.
 */

import path from "node:path";

import { decideSessionFileAccess, MAX_PATH_CHARS, type AccessArgs } from "./access.js";
import { evidenceKey } from "./evidence.js";
import { probeRegularFile } from "./safe-read.js";

export const MAX_PROBE_PATHS = 40;

export type ProbeReason = "not_found" | "not_a_file" | "not_previewable" | "unavailable";
export interface ProbeResult {
  openable: boolean;
  reason?: ProbeReason;
}

export interface ProbeArgs extends Pick<AccessArgs, "roots" | "findEvidence"> {
  paths: string[];
  /** The viewer can only render allow-listed types (same MIME allowlist as the read route). */
  /** The Viewer refuses files above this size (413); probe them as not openable too. */
  maxBytes?: number;
  previewable: (absolute: string) => boolean;
}

function lexicallyInside(roots: string[], abs: string): boolean {
  return roots.some((r) => {
    const rel = path.relative(path.resolve(r), abs);
    return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
  });
}

/** One evidence scan for the whole batch instead of one per path (a scan is a pass over up to 48 MB). */
function batchedEvidence(args: ProbeArgs): AccessArgs["findEvidence"] {
  const wanted = args.paths
    .filter((p) => p && p.length <= MAX_PATH_CHARS && !p.includes("\0") && path.isAbsolute(p))
    .map((p) => path.resolve(p))
    .filter((abs) => !lexicallyInside(args.roots, abs));
  const keys = new Set(wanted.map(evidenceKey));
  let first: Promise<{ found: Set<string>; incomplete: boolean }> | null = null;
  return async (candidates) => {
    if (wanted.length === 0 || !candidates.every((c) => keys.has(evidenceKey(c)))) return args.findEvidence(candidates);
    first ??= args.findEvidence([...new Set(wanted)]);
    const batch = await first;
    return { found: new Set(candidates.map(evidenceKey).filter((k) => batch.found.has(k))), incomplete: batch.incomplete };
  };
}

export async function probeOpenable(args: ProbeArgs): Promise<ProbeResult[]> {
  const findEvidence = batchedEvidence(args);
  const out: ProbeResult[] = [];
  for (const requested of args.paths) {
    const d = await decideSessionFileAccess({ roots: args.roots, requested, findEvidence });
    if (!d.ok) {
      out.push({ openable: false, reason: d.status === 404 ? "not_found" : "unavailable" });
      continue;
    }
    if (!args.previewable(d.absolute)) {
      out.push({ openable: false, reason: "not_previewable" });
      continue;
    }
    const f = await probeRegularFile(d.absolute, args.maxBytes);
    if (f.kind === "too_large") {
      out.push({ openable: false, reason: "not_previewable" });
      continue;
    }
    if (f.kind === "file") out.push({ openable: true });
    else out.push({ openable: false, reason: f.kind === "not_found" ? "not_found" : f.kind === "not_a_file" ? "not_a_file" : "unavailable" });
  }
  return out;
}
