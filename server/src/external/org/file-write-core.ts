/*
 * external/org/file-write-core.ts — the low-level atomic write-with-
 * precondition primitive `file-write.ts`'s `orgFileWriteCore` calls.
 *
 * Split out purely to stay under the 300-line file guideline (CLAUDE.md) —
 * mirrors the existing `beat-register-release.ts` /
 * `beat-register-release-core.ts` split in this same directory. No new
 * behavior; `performWrite`'s body and `WriteOutcome`'s shape are unchanged
 * from before the split.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import { fileFingerprint, unquoteEtag } from "../file/_helpers.js";

export type WriteOutcome =
  | { ok: true; status: 200; body: { written: true; fingerprint: string; size: number } }
  | { ok: false; status: number; body: Record<string, unknown> };

export function performWrite(
  absoluteTarget: string,
  leadsRoot: string,
  relpath: string,
  body: string,
  ifMatch: string | undefined,
  lstat: (path: string) => { isSymbolicLink(): boolean; isFile(): boolean },
): WriteOutcome {
  let lst;
  try {
    lst = lstat(absoluteTarget);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, status: 404, body: { error: "not_found", path: relpath } };
    }
    return {
      ok: false,
      status: 500,
      body: { error: "file_stat_failed", detail: String(err).slice(0, 200) },
    };
  }
  if (lst.isSymbolicLink()) {
    return { ok: false, status: 403, body: { error: "symlink_forbidden", path: relpath } };
  }
  if (!lst.isFile()) {
    return { ok: false, status: 400, body: { error: "not_a_file", path: relpath } };
  }

  const realGuard = realPathGuard(leadsRoot, absoluteTarget);
  if (!realGuard.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: "path_traversal", detail: realGuard.reason },
    };
  }

  if (!ifMatch) {
    return { ok: false, status: 400, body: { error: "precondition_required" } };
  }
  let current: Buffer;
  try {
    current = readFileSync(absoluteTarget);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, status: 404, body: { error: "not_found", path: relpath } };
    }
    return {
      ok: false,
      status: 500,
      body: { error: "file_read_failed", detail: String(err).slice(0, 200) },
    };
  }
  const currentFingerprint = fileFingerprint(current);
  if (unquoteEtag(ifMatch) !== currentFingerprint) {
    return {
      ok: false,
      status: 409,
      body: { error: "fingerprint_mismatch", currentFingerprint },
    };
  }

  const nextBuf = Buffer.from(body, "utf8");
  const tmp = join(dirname(absoluteTarget), `.org-write.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmp, nextBuf);
    renameSync(tmp, absoluteTarget);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      status: 500,
      body: { error: "write_failed", detail: String(err).slice(0, 200), path: relpath },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { written: true, fingerprint: fileFingerprint(nextBuf), size: nextBuf.length },
  };
}
