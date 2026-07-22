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
 * The disk primitives — the torn-read retry envelope (50 → 1600 ms × 6 over
 * EBUSY / EPERM / EACCES / ENOENT, insurance against AV scanners / OneDrive /
 * Defender), the POSITIONAL tail read (`readChunk` reads only `[fromByte, EOF)`,
 * never the whole file) and the newline scan — live in `session-jsonl-io.ts`,
 * which also carries the append/truncate concurrency contract they honour.
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
import { awaitingLaunchProbe } from "./session-watcher-debug.js";

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
   * `awaiting_external_start` before the user pastes). The env-gated
   * awaiting-launch diagnostic lives in `session-watcher-debug.ts`.
   */
  async findByUuid(sessionUuid: string): Promise<JsonlLocation | null> {
    const probe = awaitingLaunchProbe();
    const wanted = `${sessionUuid.toLowerCase()}.jsonl`;
    let subs: string[];
    try {
      // D06/F24 — retry transient fs errors, fast-fail ENOENT (absent dir).
      subs = await readWithRetry(() => this.deps.readdir(this.deps.projectsDir), ENOENT_FATAL);
    } catch {
      probe?.readdirFailed(sessionUuid, this.deps.projectsDir);
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
          probe?.hit(sessionUuid, sub, fs.size);
          return { path: fp, encodedCwd: sub, mtimeMs: fs.mtimeMs, sizeBytes: fs.size };
        } catch {
          return null;
        }
      }
    }
    probe?.miss(sessionUuid, subs);
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
   *
   * Returns the `JsonlLocation` it read from on success, so a caller needing
   * the file's mtime/size does not walk `~/.claude/projects` a second time for
   * an answer this call already had (iterate-2026-07-22-…-single-walk).
   */
  async readChunk(args: {
    sessionUuid: string;
    fromByte: number;
    expectFingerprint: string | null;
    /**
     * Pre-resolved location: "I walked in THIS poll — don't walk again."
     * For callers that must resolve first anyway (mission-context needs
     * `sizeBytes` to compute a tail offset; the inbox cold path walks for its
     * cache). It does not become authoritative over the bytes — the read runs
     * its own `fstat` — but `size` + `fingerprint` are taken from it, so a
     * caller relying on `expectFingerprint` for rotation must NOT pass one.
     * Construct it only via `findByUuid` / `findManyByUuid`; no route may
     * supply a path from request data.
     */
    location?: JsonlLocation | null;
  }): Promise<TranscriptReadResult> {
    const loc = args.location ?? (await this.findByUuid(args.sessionUuid));
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
    // NOTE `chunk.toByte` may exceed `chunk.size`: `size` comes from the
    // discovery stat while the read runs through the EOF its OWN handle saw.
    // Pre-existing, and load-bearing since a client cursor arrived — a
    // `fromByte` past `prevSize` is exactly what the rotation check's
    // `sizeBytes < fromByte` disjunct absorbs (internal review, LOW-5).
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
      location: loc,
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

/**
 * `location` is REQUIRED on `ok` — deliberately, so every construction site
 * (including test mocks) has to supply a real one. An optional field would let
 * a consumer keep a silent `?? findByUuid()` fallback and re-grow the second
 * walk this shape exists to remove. `rotated` carries none: no caller wants it.
 */
export type TranscriptReadResult =
  | { status: "missing" }
  | { status: "rotated"; currentFingerprint: string }
  | { status: "ok"; chunk: TranscriptChunk; location: JsonlLocation };

export function computeFingerprint(loc: JsonlLocation): string {
  return `${Math.trunc(loc.mtimeMs)}:${loc.sizeBytes}`;
}
