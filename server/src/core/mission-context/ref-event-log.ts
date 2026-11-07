/*
 * core/mission-context/ref-event-log.ts — the ASSEMBLED event log as it exists
 * on a git ref (events-drop-files, issue 978), for the merged-but-not-pulled
 * fallback in `merged-events.ts`.
 *
 * `git show <ref>:shipwright_events.jsonl` saw only the legacy file. The log is
 * now the legacy file plus `shipwright_events.archive/*.jsonl` and
 * `shipwright_events.d/*.jsonl`, so this lists the three paths with ONE
 * `git ls-tree -r -z` and reads every blob with ONE `git cat-file --batch`
 * (object ids on stdin, never paths, so no file name can break the protocol).
 * The batch output frames each blob by its size in BYTES, so it is parsed as a
 * Buffer and each blob decoded on its own — splitting decoded text by byte sizes
 * would tear the first multi-byte character.
 *
 * Read-only, ARG-ARRAY, `shell:false`. The ref and the three paths are
 * CONSTANTS chosen by the caller, never request input.
 */

import { spawn } from "node:child_process";

import {
  ARCHIVE_DIR,
  assembleEventLog,
  DROPS_DIR,
  EVENT_FILE,
  type AssembledEventLog,
  type EventSource,
} from "../event-log-assemble.js";
import type { GitRunner } from "./worktree-roots.js";

/** Same ceiling the working-tree reader gives the whole log. */
export const MAX_REF_BLOBS_BYTES = 64 * 1024 * 1024;
const BATCH_TIMEOUT_MS = 8000;

/** Reads blobs by object id → content bytes. Throws on any git failure. */
export type BlobReader = (oids: string[], cwd: string) => Promise<Map<string, Buffer>>;

/** Parse `git cat-file --batch` output: `<oid> blob <size>\n<bytes>\n` per object. */
export function parseCatFileBatch(out: Buffer): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  let at = 0;
  while (at < out.length) {
    const nl = out.indexOf(0x0a, at);
    if (nl === -1) throw new Error("cat-file: truncated header");
    const header = out.subarray(at, nl).toString("utf-8").split(" ");
    if (header.length !== 3 || header[1] !== "blob") throw new Error(`cat-file: unexpected object ${header.join(" ")}`);
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || size < 0 || nl + 1 + size > out.length) throw new Error("cat-file: bad size");
    blobs.set(header[0]!, out.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1; // the blob is followed by one LF
  }
  return blobs;
}

/** Default reader: one `git cat-file --batch`, ids on stdin, bounded and timed out. */
export const defaultBlobReader: BlobReader = (oids, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd, shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("cat-file: timeout")), BATCH_TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_REF_BLOBS_BYTES + oids.length * 128) fail(new Error("cat-file: over the size cap"));
      else chunks.push(c);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) return fail(new Error(`cat-file exited ${code}`));
      try {
        resolve(parseCatFileBatch(Buffer.concat(chunks)));
      } catch (err) {
        fail(err as Error);
      }
    });
    child.stdin.on("error", () => undefined); // an early exit surfaces through "close"
    child.stdin.end(oids.map((o) => `${o}\n`).join(""));
  });

interface TreeEntry {
  oid: string;
  path: string;
}

/** Eligible blobs from `ls-tree -r -z`: the legacy file, and direct `*.jsonl` children of the two folders. */
function eligible(lsTree: string): TreeEntry[] {
  const out: TreeEntry[] = [];
  for (const rec of lsTree.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab === -1) continue;
    const [mode, type, oid] = rec.slice(0, tab).split(" ");
    const p = rec.slice(tab + 1);
    if (type !== "blob" || mode === "120000" || !oid) continue; // symlinks are never read
    if (p === EVENT_FILE) out.push({ oid, path: p });
    for (const dir of [ARCHIVE_DIR, DROPS_DIR]) {
      const name = p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : null;
      if (name && !name.includes("/") && name.endsWith(".jsonl")) out.push({ oid, path: p });
    }
  }
  return out;
}

const rank = (p: string): number => (p === EVENT_FILE ? 0 : p.startsWith(`${ARCHIVE_DIR}/`) ? 1 : 2);

/**
 * The assembled log at `ref`, or `null` when the ref cannot be read or holds none
 * of the event files (the caller's `unavailable` — never "no such run").
 */
export async function readAssembledEventLogAtRef(
  projectRoot: string,
  ref: string,
  git: GitRunner,
  readBlobs: BlobReader = defaultBlobReader,
): Promise<AssembledEventLog | null> {
  try {
    const listing = await git(
      ["ls-tree", "-r", "-z", ref, "--", EVENT_FILE, `${ARCHIVE_DIR}/`, `${DROPS_DIR}/`],
      projectRoot,
    );
    const entries = eligible(listing).sort((a, b) =>
      rank(a.path) !== rank(b.path) ? rank(a.path) - rank(b.path) : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    if (entries.length === 0) return null;
    const blobs = await readBlobs([...new Set(entries.map((e) => e.oid))], projectRoot);
    const sources: EventSource[] = entries.map((e) => {
      const bytes = blobs.get(e.oid);
      return { path: e.path, kind: rank(e.path) === 0 ? "legacy" : rank(e.path) === 1 ? "archive" : "drop",
        text: bytes ? bytes.toString("utf-8") : null };
    });
    if (sources[0]?.kind === "legacy" && sources[0].text === null) return null;
    return assembleEventLog(sources);
  } catch {
    return null; // ref absent (never fetched), not a repo, git missing, a batch failure
  }
}
