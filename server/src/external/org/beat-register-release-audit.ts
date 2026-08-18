/*
 * external/org/beat-register-release-audit.ts — the `beat_recovered`
 * audit-append half of the release action, split out of
 * `beat-register-release-core.ts` to stay under the 300-line file
 * guideline (iterate-2026-08-18-org-route-beat-register).
 */

import { existsSync, mkdirSync, openSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { dirname } from "node:path";

import { readLeadOrgInfo } from "./org-chart-lookup.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { guardExistingTarget, type LstatFn } from "./beat-register.js";

/**
 * Create `absolutePath` empty ONLY if it does not already exist — via the
 * `wx` flag (O_CREAT|O_EXCL), mirroring `decisions-lock.ts`'s `ensureFile`.
 * Code-review fix (external cascade, medium/security): the original guard
 * was `existsSync(auditPath) ? guardExistingTarget(...) : (nothing)` —
 * `existsSync` follows symlinks and reports a DANGLING symlink as absent,
 * so a dangling `audit.jsonl` symlink skipped the guard entirely and
 * `openSync(auditPath, "a")` (which also follows symlinks) would create
 * and write through it to whatever it pointed at, outside `leadsRoot`.
 * `wx` fails `EEXIST` against ANY pre-existing path, including a dangling
 * symlink, WITHOUT following it — so this can never be the thing that
 * writes through one first. The `guardExistingTarget` call right after it
 * (now UNCONDITIONAL — the file is guaranteed to exist by this point) is
 * what actually rejects an existing (non-dangling) symlink.
 */
function ensureAuditFile(absolutePath: string): void {
  const dir = dirname(absolutePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(absolutePath, "", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
  }
}

/** Single-write append, matching leadwright's `audit-append.ts` atomicity
 *  contract (one `write()` call so the line is fully visible or not at
 *  all). `ensureAuditFile` + an unconditional `guardExistingTarget` replace
 *  the plan-review PR-1 `existsSync`-gated guard (see `ensureAuditFile`'s
 *  own doc comment for why). */
function appendAuditLine(
  leadsRoot: string,
  auditPath: string,
  lstat: LstatFn,
  entry: Record<string, unknown>,
): void {
  ensureAuditFile(auditPath);
  const guard = guardExistingTarget(leadsRoot, auditPath, lstat);
  if (!guard.ok) {
    if (guard.status === 404) {
      // The file this same function just created vanished before the very
      // next syscall — by this point the register mutation has already
      // committed, so this (like any other audit-append failure) falls
      // into the already-disclosed PR-9 non-atomicity gap (see
      // `beat-register-release-core.ts`'s `recordRecoveryAudit`). Surface
      // honestly as a plain error, not `OrgSymlinkEscapeError` — this was
      // never a symlink.
      throw new Error(`audit.jsonl vanished mid-append: ${auditPath}`);
    }
    throw new OrgSymlinkEscapeError(auditPath);
  }
  const line = JSON.stringify(entry) + "\n";
  const fd = openSync(auditPath, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/** Design decision 6: best-effort — never lets an org-chart problem block
 *  the release action itself. `null` means "couldn't resolve", not
 *  necessarily "reports to the PO". */
function resolveParentLeadId(leadsRoot: string, leadId: string): string | null {
  const info = readLeadOrgInfo(leadsRoot, leadId);
  return info.ok ? info.reportsTo : null;
}

export interface AuditDeps {
  leadsRoot: string;
  now: () => Date;
  lstat: LstatFn;
}

/**
 * MIRRORED LIMITATION (plan-review PR-9, disclosed not fixed): this runs
 * AFTER the register lock is released, identical ordering to leadwright's
 * own `recoverRegisterEntry`. A crash or audit-write failure between the
 * two leaves a recovered entry with no `beat_recovered` line — a retry
 * finds the entry already closed (`recovered: false`) and does not
 * re-append. Sharing this limitation with the mirrored contract is
 * preferred over diverging into a different (and un-mirrored) failure mode.
 */
export function recordRecoveryAudit(
  deps: AuditDeps,
  leadId: string,
  auditPath: string,
  sessionId: string,
  reason: string,
  beatId: string,
): void {
  appendAuditLine(deps.leadsRoot, auditPath, deps.lstat, {
    ts: deps.now().toISOString(),
    kind: "beat_recovered",
    lead_id: leadId,
    parent_lead_id: resolveParentLeadId(deps.leadsRoot, leadId),
    beat_id: beatId,
    summary: `register entry recovered: session ${sessionId}`,
    data: { sessionId, reason },
  });
}
