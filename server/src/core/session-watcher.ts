/*
 * Session JSONL discovery + stateless byte-range reader.
 *
 * Variant-a narrow: NO chokidar, NO recursive watchers. Discovery is
 * filename-first per PoC finding 1 — claude writes each session at
 * `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, and the filename is
 * the authoritative primitive (first-line sessionId verification is a
 * sanity check only; fork-session files begin with `file-history-snapshot`
 * lines that carry no sessionId).
 *
 * The transcript endpoint reads byte-ranges stateless: the client supplies
 * `fromByte` + `expectFingerprint`; the server returns the delta. No
 * server-side offset cache → multi-tab works by construction.
 *
 * Torn-read retry: 50 → 1600 ms × 6 attempts, catching EBUSY / EPERM /
 * EACCES / ENOENT in addition to JSON-parse errors. Plan D'' round-1
 * BLOCKER fix + Gemini BLOCKER. PoC finding 4 showed torn-reads don't fire
 * on NTFS at the write rates claude emits, but the wider retry envelope
 * remains as insurance against AV scanners / OneDrive sync / Defender.
 *
 * The disk primitives themselves — that retry envelope, the POSITIONAL tail
 * read (`readChunk` reads only `[fromByte, EOF)`, never the whole file) and the
 * newline scan — live in `session-jsonl-io.ts`, which also carries the
 * append/truncate concurrency contract they honour.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  ENOENT_FATAL,
  lastIndexOfByte,
  readTailFromDisk,
  readWithRetry,
  type TailRead,
} from "./session-jsonl-io.js";

export const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

export interface JsonlLocation {
  path: string;
  encodedCwd: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface SessionWatcherDeps {
  readdir?: (p: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number; isDirectory: () => boolean }>;
  /**
   * Positional read of `[fromByte, EOF)`. Replaced the former whole-file
   * `readFile` dep in iterate-2026-07-21-transcript-positional-tail-read — a
   * bounded-tail request must not cost an unbounded read. The old dep was
   * removed rather than kept alongside: nothing injected it, so leaving it
   * would have left an override that silently no longer changes behavior.
   */
  readTail?: (p: string, fromByte: number) => Promise<TailRead>;
  /** Override for tests; defaults to `~/.claude/projects`. */
  projectsDir?: string;
}

const DEFAULT_DEPS: Required<SessionWatcherDeps> = {
  readdir: (p) => readdir(p),
  stat: (p) =>
    stat(p).then((s) => ({
      mtimeMs: s.mtimeMs,
      size: s.size,
      isDirectory: () => s.isDirectory(),
    })),
  readTail: (p, fromByte) => readTailFromDisk(p, fromByte),
  projectsDir: PROJECTS_DIR,
};

export class SessionWatcher {
  private readonly deps: Required<SessionWatcherDeps>;

  constructor(deps: SessionWatcherDeps = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /**
   * Resolve the on-disk JSONL for a given pre-bound session UUID.
   * Returns null if no file matches yet (common during
   * `awaiting_external_start` before the user pastes).
   *
   * Iterate v0.8.2 AC-5 (awaiting-launch state lag — diagnosis): when
   * SHIPWRIGHT_DEBUG_AWAITING_LAUNCH=1, log each polled subdirectory +
   * match outcome. The known-good lower bound is ~5–15 s for Claude's
   * first JSONL write + 2–5 s server poll cadence (~20 s total). If
   * the field reports >30 s, the most likely cause is an encoded-cwd
   * mismatch — the pty was started under one cwd but `Set-Location`'d
   * before launch, while task.cwd records the original. The log shows
   * BOTH the directories walked AND a no-match outcome so the operator
   * can compare against the encoded cwd they expected.
   */
  async findByUuid(sessionUuid: string): Promise<JsonlLocation | null> {
    const debug =
      process.env.SHIPWRIGHT_DEBUG_AWAITING_LAUNCH === "1" ||
      process.env.SHIPWRIGHT_DEBUG_AWAITING_LAUNCH === "true";
    const wanted = `${sessionUuid.toLowerCase()}.jsonl`;
    let subs: string[];
    try {
      // D06/F24 — retry transient fs errors, fast-fail ENOENT (absent dir).
      subs = await readWithRetry(() => this.deps.readdir(this.deps.projectsDir), ENOENT_FATAL);
    } catch {
      if (debug) {
        // eslint-disable-next-line no-console
        console.log(
          `[awaiting-launch] readdir(projectsDir) failed for uuid=${sessionUuid} dir=${this.deps.projectsDir}`,
        );
      }
      return null;
    }
    for (const sub of subs) {
      const subPath = path.join(this.deps.projectsDir, sub);
      try {
        const s = await readWithRetry(() => this.deps.stat(subPath), ENOENT_FATAL);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      let files: string[];
      try {
        files = await readWithRetry(() => this.deps.readdir(subPath), ENOENT_FATAL);
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.toLowerCase() !== wanted) continue;
        const fp = path.join(subPath, f);
        try {
          // D06/F24 core fix — retry the matched file's stat (pre-fix a transient EBUSY here read as an authoritative "JSONL missing").
          const fs = await readWithRetry(() => this.deps.stat(fp), ENOENT_FATAL);
          if (debug) {
            // eslint-disable-next-line no-console
            console.log(
              `[awaiting-launch] HIT uuid=${sessionUuid} encodedCwd=${sub} size=${fs.size}`,
            );
          }
          return { path: fp, encodedCwd: sub, mtimeMs: fs.mtimeMs, sizeBytes: fs.size };
        } catch {
          return null;
        }
      }
    }
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(
        `[awaiting-launch] miss uuid=${sessionUuid} walked=${subs.length} encodedCwds=${subs.slice(0, 8).join(",")}${subs.length > 8 ? ",…" : ""}`,
      );
    }
    return null;
  }

  /**
   * Batch variant of {@link findByUuid} — resolves many session UUIDs in
   * a SINGLE `~/.claude/projects` walk. `GET /api/external/tasks` uses
   * this so the board delivers a LIVE JSONL mtime for every task in one
   * scan (ADR-102 — the Resume-CTA gate must not be fed the stale
   * persisted `lastJsonlSeenMtimeMs`, which only the transcript endpoint
   * of the currently-open detail page refreshes).
   *
   * Returns a Map keyed by LOWERCASE uuid. UUIDs with no matching file
   * on disk are simply absent from the result (same as `findByUuid`
   * returning null). An empty input set short-circuits with no walk.
   */
  async findManyByUuid(
    uuids: Set<string>,
  ): Promise<Map<string, JsonlLocation>> {
    const out = new Map<string, JsonlLocation>();
    // `<uuid>.jsonl` (lowercase) -> uuid (lowercase)
    const wanted = new Map<string, string>();
    for (const u of uuids) {
      const lc = u.toLowerCase();
      wanted.set(`${lc}.jsonl`, lc);
    }
    if (wanted.size === 0) return out;

    let subs: string[];
    try {
      subs = await this.deps.readdir(this.deps.projectsDir);
    } catch {
      return out;
    }
    for (const sub of subs) {
      if (out.size === wanted.size) break; // all resolved — stop the walk early
      const subPath = path.join(this.deps.projectsDir, sub);
      try {
        const s = await this.deps.stat(subPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      let files: string[];
      try {
        files = await this.deps.readdir(subPath);
      } catch {
        continue;
      }
      for (const f of files) {
        const uuid = wanted.get(f.toLowerCase());
        if (!uuid || out.has(uuid)) continue;
        const fp = path.join(subPath, f);
        try {
          const fst = await this.deps.stat(fp);
          out.set(uuid, {
            path: fp,
            encodedCwd: sub,
            mtimeMs: fst.mtimeMs,
            sizeBytes: fst.size,
          });
        } catch {
          /* unreadable — leave absent, mirrors findByUuid's null path */
        }
      }
    }
    return out;
  }

  /**
   * Read a byte-range from the JSONL with torn-read retry + UTF-8 safe
   * chunk trimming. Always returns content ending on `\n` so the client
   * never sees a partial line (and `\n` is safe to split on even in the
   * middle of a multi-byte UTF-8 sequence).
   */
  async readChunk(args: {
    sessionUuid: string;
    fromByte: number;
    expectFingerprint: string | null;
  }): Promise<TranscriptReadResult> {
    const loc = await this.findByUuid(args.sessionUuid);
    if (!loc) return { status: "missing" };
    const fingerprint = computeFingerprint(loc);

    if (args.expectFingerprint && args.expectFingerprint !== fingerprint) {
      const [, prevSizeStr] = args.expectFingerprint.split(":");
      const prevSize = Number.parseInt(prevSizeStr ?? "0", 10);
      if (loc.sizeBytes < args.fromByte || loc.sizeBytes < prevSize) {
        return { status: "rotated", currentFingerprint: fingerprint };
      }
    }

    // Positional: only `[fromByte, EOF)` leaves the disk. `liveSize` is the end
    // THAT read observed, so a file truncated between discovery and the read
    // clamps `from` exactly as the old whole-file reader implicitly did.
    // No `fatalCodes` here, deliberately: unlike discovery, a transient ENOENT
    // on the read is an AV scanner / sync client yanking a file we just saw,
    // and must be retried rather than reported as an authoritative miss.
    const { bytes, size: liveSize } = await readWithRetry(() =>
      this.deps.readTail(loc.path, args.fromByte),
    );
    const from = Math.min(Math.max(args.fromByte, 0), liveSize);
    let slice = bytes;
    let endExclusive = from + slice.length;
    const lastNl = lastIndexOfByte(slice, 0x0a);
    if (lastNl === -1) {
      slice = Buffer.alloc(0);
      endExclusive = from;
    } else {
      slice = slice.subarray(0, lastNl + 1);
      endExclusive = from + lastNl + 1;
    }

    return {
      status: "ok",
      chunk: {
        fingerprint,
        size: loc.sizeBytes,
        fromByte: from,
        toByte: endExclusive,
        content: slice.toString("utf-8"),
      },
    };
  }
}

// ---------- helpers ----------

export interface TranscriptChunk {
  fingerprint: string;
  size: number;
  fromByte: number;
  toByte: number;
  content: string;
}

export type TranscriptReadResult =
  | { status: "missing" }
  | { status: "rotated"; currentFingerprint: string }
  | { status: "ok"; chunk: TranscriptChunk };

export function computeFingerprint(loc: JsonlLocation): string {
  return `${Math.trunc(loc.mtimeMs)}:${loc.sizeBytes}`;
}

// The torn-read retry envelope, the positional tail read and the newline scan
// live in `session-jsonl-io.ts` — imported above, re-exported nowhere.
