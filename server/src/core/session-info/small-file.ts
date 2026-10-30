/*
 * Read a small regular file with ONE open and no path-based check before it
 * (CodeQL js/file-system-race: an `lstat(p)` followed by `readFile(p)` lets the
 * file change between the check and the read). The checks run on the open
 * handle instead:
 *   - `O_NOFOLLOW` (POSIX) refuses a symlink at open time; `O_NONBLOCK` keeps a
 *     FIFO planted under the name from blocking the open.
 *   - `fh.stat()` must be a regular file within `maxBytes`.
 *   - Windows has no `O_NOFOLLOW`, so a post-open `lstat` must agree: not a
 *     symlink, and the same file (dev + ino) as the one actually opened.
 * Read-only (CLAUDE.md DO-NOT #1). Returns null on anything unexpected.
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

const FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export async function readSmallRegularFile(p: string, maxBytes: number): Promise<string | null> {
  let fh;
  try {
    fh = await open(p, FLAGS);
  } catch {
    return null; // missing, symlink (ELOOP), directory, permission
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile() || st.size > BigInt(maxBytes)) return null;
    const link = await lstat(p, { bigint: true });
    if (link.isSymbolicLink() || link.dev !== st.dev || link.ino !== st.ino) return null;
    const buf = Buffer.alloc(Number(st.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => {});
  }
}
