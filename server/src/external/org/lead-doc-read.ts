/*
 * external/org/lead-doc-read.ts — GET-only read for a lead's `learnings.md`.
 *
 * Deliberately NOT part of `_helpers.ts`'s six-target allowlist — that
 * allowlist's own docstring calls it a fixed, shared contract with the
 * secret-gated family (`external/org/routes.ts`), and widening it would
 * change what BOTH families accept. `learnings.md` is a read this iterate's
 * new plain `/api/org/*` surface needs (Docs block, AC-2) that the gated
 * family never exposed and doesn't need to; this module — and the sibling
 * `audit-log.ts` for `audit.jsonl` — exist to add it additively, without
 * touching that stable contract.
 *
 * `leadId` is validated against `LEAD_ID_RE` (same validator every other
 * org route shares — never a second one) and the filename suffix is a
 * hardcoded constant, never client-supplied — so unlike the six-target
 * allowlist's raw `path=` input, there is no string for a traversal
 * sequence to hide in. `pathGuard` runs anyway as defense in depth against
 * a future caller changing that; `realPathGuard` (which needs the target to
 * already exist — see its own docstring) is applied AFTER the open, unlike
 * `file-read.ts`'s ordering, precisely so a genuinely-missing file 404s
 * instead of realpathSync's ENOENT reporting as `path_traversal` first.
 */

import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import { LEAD_ID_RE } from "./_helpers.js";
import { fileFingerprint } from "../file/_helpers.js";

export type LeadDocReadResult =
  | { status: 200; kind: "file"; body: Buffer; headers: Record<string, string> }
  | { status: 400 | 403 | 404 | 500; kind: "json"; body: { error: string; detail?: string } };

export interface LeadDocReadDeps {
  leadsRoot: string;
  openSync?: typeof openSync;
}

const LEARNINGS_FILENAME = "learnings.md";

/** Pure core — reads `<leadsRoot>/<leadId>/learnings.md`. */
export function leadLearningsReadCore(deps: LeadDocReadDeps, leadId: string | undefined): LeadDocReadResult {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;

  if (!leadId || !LEAD_ID_RE.test(leadId)) {
    return { status: 400, kind: "json", body: { error: "invalid_lead_id" } };
  }

  const guard = pathGuard(leadsRoot, join(leadId, LEARNINGS_FILENAME));
  if (!guard.ok) {
    return { status: 400, kind: "json", body: { error: "path_traversal", detail: guard.reason } };
  }

  let fd: number;
  try {
    fd = open(guard.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 404, kind: "json", body: { error: "not_found" } };
    }
    if (code === "ELOOP") {
      return { status: 403, kind: "json", body: { error: "symlink_forbidden" } };
    }
    return { status: 500, kind: "json", body: { error: "file_stat_failed", detail: String(err).slice(0, 200) } };
  }

  try {
    if (!fstatSync(fd).isFile()) {
      return { status: 400, kind: "json", body: { error: "not_a_file" } };
    }
    // Existence is now confirmed (the open above succeeded) — realPathGuard's
    // own contract requires exactly this ordering.
    const realGuard = realPathGuard(leadsRoot, guard.absolute);
    if (!realGuard.ok) {
      return { status: 403, kind: "json", body: { error: "symlink_forbidden", detail: realGuard.reason } };
    }
    const body = readFileSync(fd);
    return {
      status: 200,
      kind: "file",
      body,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${fileFingerprint(body)}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    };
  } catch (err) {
    return { status: 500, kind: "json", body: { error: "file_read_failed", detail: String(err).slice(0, 200) } };
  } finally {
    closeSync(fd);
  }
}
