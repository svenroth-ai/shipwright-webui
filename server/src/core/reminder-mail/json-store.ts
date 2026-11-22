/*
 * json-store.ts — tiny locked JSON file helper for the reminder-mail state
 * (settings, sent-ledger, status). Multi-writer rule (CLAUDE.md DO-NOT #6): every
 * mutation is a read-modify-write under a `proper-lockfile` lock; the write is
 * temp-file + rename so a crash never leaves a torn file. Reads are lock-free
 * and tolerant (missing / corrupt / wrong shape -> the empty value).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createTriageLock } from "../triage-lock.js";

export type Lock = (p: string) => Promise<() => Promise<void>>;

export const defaultLock: Lock = createTriageLock(5);

export function readJson<T>(file: string, normalize: (raw: unknown) => T): T {
  try {
    return normalize(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return normalize(undefined);
  }
}

/** A file that has content which is not JSON is DAMAGED: never treat it as empty (that would forget what was mailed). */
export class DamagedStateError extends Error {}
function assertReadable(file: string): void {
  const text = readFileSync(file, "utf-8");
  if (text.trim() === "") return;
  try {
    JSON.parse(text);
  } catch {
    throw new DamagedStateError(`${path.basename(file)} is damaged`);
  }
}

export function writeAtomic(file: string, data: unknown, mode: number, raw = false): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, raw ? String(data) : JSON.stringify(data, null, 2), { mode });
  // Windows: a concurrent reader can hold the target for a moment (EPERM/EBUSY): retry briefly.
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 6 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        try { unlinkSync(tmp); } catch { /* best effort: never leave a second copy of the content behind */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
    }
  }
}

/** Locked read-modify-write. `fn` mutates (or returns a replacement for) the value. */
export async function updateJson<T>(
  file: string,
  normalize: (raw: unknown) => T,
  fn: (cur: T) => T | void,
  lock: Lock = defaultLock,
  opts: { strict?: boolean; mode?: number } = {},
): Promise<T> {
  const mode = opts.mode ?? 0o600;
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // proper-lockfile needs the file to exist; "wx" never truncates one another process just wrote.
  try {
    writeFileSync(file, "", { mode, flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const release = await lock(file);
  try {
    if (opts.strict) assertReadable(file);
    const cur = readJson(file, normalize);
    const next = fn(cur) ?? cur;
    writeAtomic(file, next, mode);
    return next;
  } finally {
    await release();
  }
}
