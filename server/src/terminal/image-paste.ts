/*
 * image-paste.ts — server-side handler for the embedded-terminal image-paste
 * flow (iterate-2026-05-03 / ADR-067). Pure module: routes.ts wraps the
 * HTTP envelope.
 *
 * Storage layout: <task.cwd>/.shipwright-webui/pastes/img-<unix-ms>-<8 hex>.png
 *   - filename includes random hex to avoid collision under rapid pastes
 *     within the same millisecond (external review F17a).
 *   - prune sorts by parsed timestamp from the filename, with fs mtime as
 *     tiebreaker only — deterministic on filesystems with low mtime
 *     resolution (F17b).
 *   - Iterate v0.8.2 AC-6: directory moved from `.claude-pastes/` →
 *     `.shipwright-webui/pastes/` to align with the convention dir the
 *     rest of webui already writes to. Existing `.claude-pastes/` files
 *     stay where they are; only NEW pastes land in the new path.
 *
 * Path-safety: callers MUST hand a `task.cwd` that has been validated
 * upstream. This module re-applies `pathGuard` + `realPathGuard` against
 * the pastes dir (after mkdir) so a malicious symlink in the project
 * tree can't redirect writes outside the cwd (F11 generalisation).
 *
 * Mime + size: PNG / JPEG / WEBP / GIF whitelisted (magic-byte sniff is
 * the source of truth — Content-Type headers are advisory). Hard cap at
 * 8 MiB; the route enforces a Content-Length precheck at 9 MiB to fail
 * fast before buffering (F15).
 */

import { promises as fs } from "node:fs";
import { realpathSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { pathGuard, realPathGuard } from "../core/path-guard.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Iterate v0.8.2 AC-6: pastes now live under the project-level webui
// convention dir. Joined with `path.join` for cross-platform separators.
export const PASTES_DIR = path.join(".shipwright-webui", "pastes");
// Iterate v0.8.2 AC-6: gitignore suggestion now points at the parent
// convention dir — one entry covers pastes + any future webui-only
// scratch surfaces.
export const PASTES_GITIGNORE_HINT = ".shipwright-webui/";

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

export class ImagePasteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ImagePasteError";
  }
}

/** Magic-byte sniff: returns the kind, or null if unrecognised. */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }
  return null;
}

const EXT_FOR_KIND: Record<ImageKind, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};

/**
 * Parse the timestamp out of a filename of the form `img-<ms>-<hex>.<ext>`.
 * Falls back to `Number.NaN` if the filename does not match — caller
 * uses it as the primary sort key (older = smaller; NaN sorts last).
 */
export function parseFilenameTimestamp(name: string): number {
  const m = /^img-(\d+)-[0-9a-fA-F]+\.[a-z]+$/.exec(name);
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : Number.NaN;
}

export interface PruneResult {
  kept: string[];
  deleted: string[];
}

/**
 * Keep the `n` newest `img-*` files in `dir` (by parsed-timestamp primary,
 * fs mtime tiebreaker), unlink the rest. Idempotent + symlink-safe.
 *
 * Iterate v0.8.2 AC-4: stat() calls run in parallel via Promise.all.
 * Sequential per-file stats added measurable latency on Windows where each
 * syscall is ~50-100 ms; with a 20-deep `keepLast` window this could
 * dominate the paste roundtrip on its own.
 */
export async function pruneKeepLastN(dir: string, n: number): Promise<PruneResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { kept: [], deleted: [] };
  }
  const candidates = entries.filter((e) => /^img-/.test(e));
  if (candidates.length <= n) return { kept: candidates, deleted: [] };

  const enriched = await Promise.all(
    candidates.map(async (name) => {
      let mtime = 0;
      try {
        const st = await fs.stat(path.join(dir, name));
        mtime = st.mtimeMs;
      } catch {
        mtime = 0;
      }
      return { name, ts: parseFilenameTimestamp(name), mtime };
    }),
  );
  // Sort newest-first by parsed timestamp, mtime tiebreaker, name as final.
  enriched.sort((a, b) => {
    const aTs = Number.isNaN(a.ts) ? -Infinity : a.ts;
    const bTs = Number.isNaN(b.ts) ? -Infinity : b.ts;
    if (bTs !== aTs) return bTs - aTs;
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.name < b.name ? 1 : -1;
  });

  const kept = enriched.slice(0, n).map((e) => e.name);
  const drop = enriched.slice(n).map((e) => e.name);
  // Iterate v0.8.2 AC-4: unlinks run in parallel — best-effort, raced
  // deletes are still fine.
  await Promise.all(
    drop.map(async (name) => {
      try {
        await fs.unlink(path.join(dir, name));
      } catch {
        /* best-effort */
      }
    }),
  );
  return { kept, deleted: drop };
}

export interface SaveOpts {
  cwd: string;
  bytes: Uint8Array;
  /** Configurable retention; default 20 per task.cwd. */
  keepLast: number;
}

export interface SaveResult {
  /** Absolute path of the freshly-written image. */
  absolutePath: string;
  /** Detected image kind from magic bytes. */
  kind: ImageKind;
  /** Whether `<cwd>/.gitignore` exists AND lacks a `.claude-pastes/` line. */
  gitignoreSuggestion: boolean;
  /** Result of the keep-last-N prune. */
  prune: PruneResult;
}

export async function savePastedImage(opts: SaveOpts): Promise<SaveResult> {
  const { cwd, bytes, keepLast } = opts;
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImagePasteError("image_too_large", `image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }
  const kind = sniffImageKind(bytes);
  if (!kind) {
    throw new ImagePasteError(
      "unsupported_image_type",
      "image must be png/jpeg/webp/gif (magic-byte sniff failed)",
    );
  }

  // Resolve the .claude-pastes dir under cwd via the path-guard, then
  // mkdir, then re-realpath-guard to defeat any symlink that may have
  // appeared between the string check and the actual write.
  const dirGuard = pathGuard(cwd, PASTES_DIR);
  if (!dirGuard.ok) {
    throw new ImagePasteError("path_guard_traversal", `pastes dir guard failed: ${dirGuard.reason}`);
  }
  await fs.mkdir(dirGuard.absolute, { recursive: true });
  const realDirGuard = realPathGuard(cwd, dirGuard.absolute);
  if (!realDirGuard.ok) {
    throw new ImagePasteError(
      "path_guard_symlink_escape",
      `pastes dir realpath guard failed: ${realDirGuard.reason}`,
    );
  }

  // Filename: img-<unix-ms>-<8 hex>.<ext>
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString("hex");
  const filename = `img-${ts}-${rand}.${EXT_FOR_KIND[kind]}`;
  const absolute = path.join(realDirGuard.absolute, filename);

  await fs.writeFile(absolute, bytes);
  // Re-confirm with realpath now that the file exists, so a TOCTOU
  // symlink swap during the write is also caught.
  let realAbsolute = absolute;
  try {
    realAbsolute = realpathSync(absolute);
  } catch {
    /* realpath of a freshly-written file should rarely fail; fall back. */
  }
  // Final containment check after write.
  const finalGuard = realPathGuard(cwd, realAbsolute);
  if (!finalGuard.ok) {
    // Best-effort: try to delete what we just wrote so we don't leak
    // bytes into a symlinked location.
    try {
      await fs.unlink(realAbsolute);
    } catch {
      /* ignore */
    }
    throw new ImagePasteError(
      "path_guard_symlink_escape",
      `final realpath guard failed: ${finalGuard.reason}`,
    );
  }

  // Iterate v0.8.2 AC-4: prune + gitignore-check run in parallel — they
  // touch disjoint paths and were a measurable serialised tail on Windows.
  // Iterate v0.8.2 AC-6: gitignore detection accepts EITHER the legacy
  // `.claude-pastes/` line OR the new `.shipwright-webui/` line so users
  // who already gitignored the legacy dir don't get a stale suggestion.
  const [prune, gitignoreSuggestion] = await Promise.all([
    pruneKeepLastN(realDirGuard.absolute, keepLast),
    (async () => {
      try {
        const giPath = path.join(cwd, ".gitignore");
        const giContents = await fs.readFile(giPath, "utf8");
        const hasShipwrightLine = /\.shipwright-webui\/?(\s|$)/.test(giContents);
        const hasLegacyLine = /\.claude-pastes\/?(\s|$)/.test(giContents);
        return !hasShipwrightLine && !hasLegacyLine;
      } catch {
        return false;
      }
    })(),
  ]);

  return { absolutePath: realAbsolute, kind, gitignoreSuggestion, prune };
}

/**
 * Idempotent append of `.shipwright-webui/` to `<cwd>/.gitignore`. Returns
 * true if the line was appended, false if it was already present or the
 * file is missing. Caller is expected to have already gone through
 * pathGuard + realPathGuard on the .gitignore target.
 *
 * Iterate v0.8.2 AC-6: the entry now points at the parent webui convention
 * dir; legacy `.claude-pastes/` lines are accepted as already-covering so
 * a project that gitignored the old layout does not get a duplicate
 * append.
 */
export async function appendGitignoreLine(absoluteGitignorePath: string): Promise<boolean> {
  let contents: string;
  try {
    contents = await fs.readFile(absoluteGitignorePath, "utf8");
  } catch {
    return false;
  }
  if (
    /\.shipwright-webui\/?(\s|$)/.test(contents) ||
    /\.claude-pastes\/?(\s|$)/.test(contents)
  ) {
    return false;
  }
  const sep = contents.endsWith("\n") || contents.length === 0 ? "" : "\n";
  await fs.writeFile(
    absoluteGitignorePath,
    contents + sep + PASTES_GITIGNORE_HINT + "\n",
    "utf8",
  );
  return true;
}
