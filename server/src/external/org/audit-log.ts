/*
 * external/org/audit-log.ts — bounded, paginated read of a lead's
 * `audit.jsonl` for the Docs block's "Open log" tile (AC-2, Design Notes
 * "Docs block — view-only contract"). Never serves the whole growing file
 * to the browser at once: the RESPONSE is always capped at `limit` entries,
 * newest first, with a `nextCursor` to page into older entries.
 *
 * Known limitation, stated rather than hidden: the current read still loads
 * the whole file into memory server-side before slicing a page off it (no
 * disk-level tail/backward-chunk read, unlike the transcript JSONL tail
 * reader in `core/session-jsonl-io.ts`, which exists for a much larger,
 * continuously-streamed file). Acceptable for a per-lead audit log at this
 * iterate's scale; a real backward-chunked reader is a follow-up if a log
 * grows large enough to make this measurably slow.
 *
 * Same allowlist posture as `lead-doc-read.ts`: `leadId` is validated
 * against the shared `LEAD_ID_RE`, the filename suffix is a hardcoded
 * constant, and this stays OUT of `_helpers.ts`'s six-target allowlist —
 * it's a new read only the plain `/api/org/*` surface serves.
 */

import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import { LEAD_ID_RE } from "./_helpers.js";
import type { AuditLogEntry, AuditLogPage } from "../../types/org.js";

export type { AuditLogEntry, AuditLogPage } from "../../types/org.js";

const AUDIT_FILENAME = "audit.jsonl";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type AuditLogCoreResult =
  | { status: 200; body: AuditLogPage }
  | { status: 400 | 403 | 404 | 500; body: { error: string; detail?: string } };

export interface AuditLogDeps {
  leadsRoot: string;
  openSync?: typeof openSync;
}

export interface AuditLogParams {
  leadId: string | undefined;
  /** Number of already-consumed newest-first entries to skip. Default 0. */
  before?: number;
  /** Page size, clamped to `[1, MAX_LIMIT]`. Default `DEFAULT_LIMIT`. */
  limit?: number;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(raw)));
}

/** Pure core — reads and paginates `<leadsRoot>/<leadId>/audit.jsonl`. */
export function auditLogCore(deps: AuditLogDeps, params: AuditLogParams): AuditLogCoreResult {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;
  const { leadId } = params;
  const limit = clampLimit(params.limit);
  const before = params.before !== undefined && Number.isFinite(params.before) && params.before > 0
    ? Math.trunc(params.before)
    : 0;

  if (!leadId || !LEAD_ID_RE.test(leadId)) {
    return { status: 400, body: { error: "invalid_lead_id" } };
  }

  const guard = pathGuard(leadsRoot, join(leadId, AUDIT_FILENAME));
  if (!guard.ok) {
    return { status: 400, body: { error: "path_traversal", detail: guard.reason } };
  }

  let fd: number;
  try {
    fd = open(guard.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 404, body: { error: "not_found" } };
    }
    if (code === "ELOOP") {
      return { status: 403, body: { error: "symlink_forbidden" } };
    }
    return { status: 500, body: { error: "file_stat_failed", detail: String(err).slice(0, 200) } };
  }

  try {
    if (!fstatSync(fd).isFile()) {
      return { status: 400, body: { error: "not_a_file" } };
    }
    const realGuard = realPathGuard(leadsRoot, guard.absolute);
    if (!realGuard.ok) {
      return { status: 403, body: { error: "symlink_forbidden", detail: realGuard.reason } };
    }

    const text = readFileSync(fd, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const newestFirst = lines.slice().reverse();
    const page = newestFirst.slice(before, before + limit).map((raw): AuditLogEntry => {
      try {
        return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
      } catch {
        return { raw, parsed: null };
      }
    });
    const nextCursor = before + limit < newestFirst.length ? before + limit : null;

    return { status: 200, body: { entries: page, total: newestFirst.length, nextCursor } };
  } catch (err) {
    return { status: 500, body: { error: "file_read_failed", detail: String(err).slice(0, 200) } };
  } finally {
    closeSync(fd);
  }
}
