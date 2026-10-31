/*
 * Read ONE regular file with a single open and every check on the open handle
 * (CodeQL js/file-system-race: a path-based stat followed by a read lets the
 * file change in between). Read-only (CLAUDE.md DO-NOT #1).
 *   - O_NOFOLLOW (POSIX) refuses a symlink planted at the final component;
 *     O_NONBLOCK keeps a FIFO from blocking the open.
 *   - fh.stat() must say regular file, within `maxBytes`.
 *   - Windows has no O_NOFOLLOW: a post-open lstat must agree (not a symlink,
 *     same dev+ino as the handle actually opened).
 *   - O_NOFOLLOW guards only the LAST component: after the open, the path must
 *     still resolve to ITSELF (callers pass an already-realpath'd path), which
 *     catches an ancestor directory swapped for a link since authorization.
 *     Portable handle-anchored traversal does not exist in Node; this narrows
 *     the window rather than closing it (recorded residual risk).
 * No directory is ever listed; a directory fails the isFile() check.
 */

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";

const FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export type SafeReadResult =
  | { kind: "ok"; bytes: Buffer }
  | { kind: "not_found" }
  | { kind: "not_a_file" }
  | { kind: "too_large"; size: number }
  | { kind: "error"; detail: string };

/** `p` MUST be the output of realpath(): anything else is treated as an ancestor swap and refused. */
export async function readRegularFileCapped(p: string, maxBytes: number): Promise<SafeReadResult> {
  let fh;
  try {
    fh = await open(p, FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "not_found" };
    // ELOOP (symlink under O_NOFOLLOW), EISDIR, EACCES/EPERM: nothing readable here.
    if (code === "ELOOP" || code === "EISDIR") return { kind: "not_a_file" };
    return { kind: "error", detail: String(code ?? err).slice(0, 80) };
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) return { kind: "not_a_file" };
    if (st.size > BigInt(maxBytes)) return { kind: "too_large", size: Number(st.size) };
    // realpath on BOTH sides of the lstat narrows the swap-and-restore window (no O_NOFOLLOW on Windows).
    if ((await realpath(p)) !== p) return { kind: "not_a_file" };
    const link = await lstat(p, { bigint: true });
    if (link.isSymbolicLink() || link.dev !== st.dev || link.ino !== st.ino) return { kind: "not_a_file" };
    if ((await realpath(p)) !== p) return { kind: "not_a_file" };
    const buf = Buffer.alloc(Number(st.size));
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return { kind: "ok", bytes: buf.subarray(0, off) };
  } catch (err) {
    return { kind: "error", detail: String((err as NodeJS.ErrnoException)?.code ?? err).slice(0, 80) };
  } finally {
    await fh.close().catch(() => {});
  }
}
