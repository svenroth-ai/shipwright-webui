/*
 * Read-only tail of ONE subagent's JSONL (`<session>/subagents/agent-<id>.jsonl`)
 * for the Mission Agents window (campaign mission-desktop-style, M4).
 *
 * Safety, in order: the id is validated against the filename grammar; the file
 * path is realpath'd and must equal EXACTLY `<uuid>/subagents/agent-<id>.jsonl`
 * under the session's project dir (realpath + path.relative, never startsWith
 * — CLAUDE.md DO-NOT #10) so a symlink cannot point at another session or
 * outside the tree; the file is opened ONCE and the HANDLE is checked to be a
 * regular file (no stat-then-open race). ONE open serves both the size and the
 * positional read of `[size - MAX, size)` inside the retry envelope of
 * `session-jsonl-io.ts`; the window is cut on `\n` boundaries only (rule 5), so
 * a 100 MB agent file costs a flat ~1 MB read. Stateless: no cursor, no cache
 * (rule 4).
 */

import { open, realpath } from "node:fs/promises";
import path from "node:path";

import { ENOENT_FATAL, readWithRetry } from "../session-jsonl-io.js";

export const SUBAGENT_TRANSCRIPT_MAX_BYTES = 1024 * 1024;
export const AGENT_ID_RE = /^[A-Za-z0-9]{1,64}$/;

export type SubagentTranscript =
  | { status: "ok"; content: string; truncated: boolean; sizeBytes: number }
  | { status: "missing" };

async function readWindow(real: string, maxBytes: number): Promise<{ bytes: Buffer; start: number; size: number }> {
  const fh = await open(real, "r");
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw Object.assign(new Error("not a regular file"), { code: "ENOTREG" });
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.allocUnsafe(size - start);
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await fh.read(buf, off, buf.length - off, start + off);
      if (bytesRead === 0) break; // the file shrank under us
      off += bytesRead;
    }
    return { bytes: buf.subarray(0, off), start, size };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export async function readSubagentTranscript(
  sessionPath: string,
  agentId: string,
  maxBytes: number = SUBAGENT_TRANSCRIPT_MAX_BYTES,
): Promise<SubagentTranscript> {
  if (!AGENT_ID_RE.test(agentId)) return { status: "missing" };
  const name = `agent-${agentId}.jsonl`;
  const expected = path.join(path.basename(sessionPath, ".jsonl"), "subagents", name);
  let real: string;
  try {
    const [realRoot, realFile] = await Promise.all([
      realpath(path.dirname(sessionPath)),
      realpath(path.join(path.dirname(sessionPath), expected)),
    ]);
    if (fold(path.relative(realRoot, realFile)) !== fold(expected)) return { status: "missing" };
    real = realFile;
  } catch {
    return { status: "missing" };
  }
  try {
    const w = await readWithRetry(() => readWindow(real, maxBytes), ENOENT_FATAL);
    let bytes = w.bytes;
    // Mid-file start: drop the partial first line. A line still being appended is dropped too.
    if (w.start > 0) bytes = bytes.subarray(bytes.indexOf(10) + 1);
    bytes = bytes.subarray(0, bytes.lastIndexOf(10) + 1);
    return { status: "ok", content: bytes.toString("utf8"), truncated: w.start > 0, sizeBytes: w.size };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTREG" || code === "EISDIR" || code === "EPERM" || code === "EACCES") return { status: "missing" };
    throw err;
  }
}
