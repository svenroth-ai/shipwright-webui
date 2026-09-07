/*
 * org-file-lock.ts — generic single-target-file lock, structurally copied
 * from external/org/decisions-lock.ts's withDecisionsLock (which is
 * hardcoded to decisions-proposed.md/decision_log.md, so not directly
 * reusable) for the new leadwright-setup-wizard write routes
 * (iterate-2026-09-07-leadwright-setup-wizard, W14): org-chart.json,
 * daemon-config.json, and a new <leadId>/charter.md — three independent
 * files, three independent lock acquisitions, never a combined lock.
 *
 * `mustExist` — see the module-level test file header: the existence check
 * for daemon-config.json happens via proper-lockfile's own realpath ENOENT
 * on `lock()` itself (no ensureFile, no prior existsSync), so there is no
 * TOCTOU window between "check it's there" and "lock it".
 */
import * as lockfile from "proper-lockfile";
import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

import { claimRecordLockOptions } from "../../core/claim-record-lock.js";

export class OrgFileSymlinkEscapeError extends Error {
  constructor(public readonly path: string) {
    super(`refusing to lock/write through a symlink: ${path}`);
  }
}

export interface OrgFileLockOptions {
  /** When true, never create the target — a missing file throws ENOENT
   *  from lockfile.lock() itself (its own realpath resolution), which the
   *  caller interprets as "not there" (e.g. daemon-config.json's
   *  "show a copy-paste fragment instead" branch). Default false: the
   *  target is created empty (wx-flag exclusive create) if missing, same
   *  as decisions-lock.ts's ensureFile. */
  mustExist?: boolean;
  /** Test seam, mirrors DecisionsLockDeps.lstatSync. */
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export interface OrgFileLockContext {
  absolutePath: string;
  read(): string;
  write(content: string): void;
}

export type LstatFn = (path: string) => { isSymbolicLink(): boolean };

/** Exported so `commit-writes.ts`'s charter.md write (deliberately outside
 *  `withOrgFileLock` — no lock, see that file's header comment) can reuse
 *  the SAME check rather than re-implementing it — code-review fix: two
 *  independent copies of this exact logic is the drift risk this file's
 *  own header comment warns about. */
export function assertNotSymlink(absolutePath: string, lstat: LstatFn): void {
  let lst;
  try {
    lst = lstat(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw err;
  }
  if (lst.isSymbolicLink()) {
    throw new OrgFileSymlinkEscapeError(absolutePath);
  }
}

/** Same wx-flag exclusive-create discipline as decisions-lock.ts's
 *  ensureFile — never existsSync+writeFileSync (a dangling symlink would
 *  read as absent and get written through). */
function ensureFile(absolutePath: string): void {
  const dir = dirname(absolutePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(absolutePath, "", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
  }
}

/**
 * Acquire an exclusive lock on `absolutePath` (same `stale`/`realpath`
 * contract as `claimRecordLockOptions` — `../../core/claim-record-lock.js`),
 * run `fn` inside the critical section, then release. Symlink-checked
 * before AND immediately after acquisition (closes the TOCTOU window in
 * `lockfile.lock()`'s own retry backoff — same reasoning as
 * decisions-lock.ts's `withDecisionsLock`).
 */
export async function withOrgFileLock<T>(
  absolutePath: string,
  options: OrgFileLockOptions,
  fn: (ctx: OrgFileLockContext) => Promise<T> | T,
): Promise<T> {
  const lstat = options.lstatSync ?? ((p: string) => lstatSync(p));

  if (!options.mustExist) {
    ensureFile(absolutePath);
  }
  assertNotSymlink(absolutePath, lstat);

  const release = await lockfile.lock(
    absolutePath,
    claimRecordLockOptions({
      retries: { retries: 8, minTimeout: 50, maxTimeout: 500, factor: 2 },
    }),
  );
  try {
    assertNotSymlink(absolutePath, lstat);
    const ctx: OrgFileLockContext = {
      absolutePath,
      read: () => readFileSync(absolutePath, "utf8"),
      write: (content: string) => writeFileSync(absolutePath, content, "utf8"),
    };
    return await fn(ctx);
  } finally {
    await release();
  }
}
