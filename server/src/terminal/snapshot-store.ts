/*
 * snapshot-store.ts — Iterate A (ADR-088)
 *
 * Disk persistence for headless-mirror cell-state snapshots. Per-task
 * `<scrollbackDir>/<taskId>.snapshot` (same directory as scrollback-store,
 * separate extension so existing `.log` / `.log.1` artifacts are
 * undisturbed). Atomic write via temp file + rename.
 *
 * File format (UTF-8 plain text):
 *
 *     # shipwright-snapshot v1 xterm@<terminalVersion> <cols>x<rows>\n
 *     <serializedPayload>
 *
 * Example header:
 *
 *     # shipwright-snapshot v1 xterm@5.5.0 120x30
 *
 * Header semantics (external review OpenAI #8 — disambiguation):
 *   `<cols>x<rows>` is the FINAL terminal size at the moment the
 *   snapshot was written (i.e. the pty's last-known dimensions before
 *   pty.kill / pty.onExit). It is NOT initial size, and resize history
 *   is NOT preserved. Iterate A is write-only; the consumer in Iterate
 *   B uses these dims to construct a replay-time Terminal of matching
 *   shape so the serialize→write idempotence (M2) holds.
 *
 * Version semantics:
 *   - `v1` is the current envelope version. Bump on incompatible header
 *     changes (e.g. adding a hash field, JSON envelope, …).
 *   - `xterm@<version>` is the @xterm/headless / @xterm/addon-serialize
 *     PINNED version that produced the payload (architecture
 *     invariant #4 in the plan-of-record). On read, the caller MAY
 *     reject snapshots whose terminalVersion does not match the
 *     currently-pinned version — Iterate A only embeds it; Iterate B
 *     wires the strict-match policy at the replay path.
 *
 * Path-safety: reuses the same UUID + realpath patterns as
 * scrollback-store.ts. UUID format is validated on every public method;
 * realpath is verified at op-time (defeats mid-runtime symlink swap).
 * File mode 0o600 / dir mode 0o700 on POSIX (Windows ignores POSIX
 * modes — same caveat as scrollback-store privacy disclosure).
 *
 * Read more: .shipwright/planning/embedded-terminal-refactor-headless.md
 * § "Iterate A — Headless mirror behind feature flag".
 */

import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Pinned terminal-emulator version that produced the snapshot payload.
// Sourced from @xterm/headless's package.json at module load. We do NOT
// hardcode because the plan invariant pins via npm dependency (exact
// version, no caret) — so the package.json is the source of truth.
//
// Surfaced separately via getTerminalVersion() so the snapshot writer
// always embeds the same string the runtime is using.
let cachedTerminalVersion: string | null = null;

async function readTerminalVersion(): Promise<string> {
  if (cachedTerminalVersion !== null) return cachedTerminalVersion;
  // Resolve via fileURLToPath so Windows paths come out as
  // `C:\path\to\file` instead of `/C:/path/to/file` (which path.resolve
  // mangles when joined with `..` segments).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Dev/test layout — server/src/terminal/snapshot-store.ts
    path.resolve(here, "../../node_modules/@xterm/headless/package.json"),
    // Production build layout — server/dist/terminal/snapshot-store.js
    path.resolve(here, "../node_modules/@xterm/headless/package.json"),
    // Repo-root fallback (`server/` is a workspace child)
    path.resolve(here, "../../../node_modules/@xterm/headless/package.json"),
  ];
  for (const cand of candidates) {
    try {
      const raw = await fsAsync.readFile(cand, "utf8");
      const json = JSON.parse(raw) as { version?: string };
      if (typeof json.version === "string" && json.version.length > 0) {
        cachedTerminalVersion = json.version;
        return cachedTerminalVersion;
      }
    } catch {
      // try next candidate
    }
  }
  // Last-resort sentinel — should never fire in normal install.
  cachedTerminalVersion = "unknown";
  return cachedTerminalVersion;
}

/** Test-only: reset the version cache so tests can stub a fresh read. */
export function _resetTerminalVersionCacheForTesting(): void {
  cachedTerminalVersion = null;
}

const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;
const SUPPORTED_VERSIONS = new Set<string>(["v1"]);

export class SnapshotStoreError extends Error {
  constructor(
    public readonly code:
      | "invalid_task_id"
      | "snapshot_path_outside_dir"
      | "unknown_version"
      | "malformed_header",
    message: string,
  ) {
    super(message);
    this.name = "SnapshotStoreError";
  }
}

export interface SnapshotHeader {
  version: "v1";
  terminalVersion: string;
  cols: number;
  rows: number;
}

export interface SnapshotRecord extends SnapshotHeader {
  data: string;
}

export interface SnapshotStoreOpts {
  /** POSIX file mode for `<taskId>.snapshot`. Ignored on Windows. */
  fileMode?: number;
  /** POSIX dir mode for the snapshot directory. Ignored on Windows. */
  dirMode?: number;
}

/**
 * Per-task snapshot persistence.
 *
 * Lifecycle:
 *   - new SnapshotStore(dir)        — server bootstrap
 *   - await store.init()            — ensure dir + cache realpath
 *   - await store.write(taskId, …)  — pty.kill path
 *   - await store.read(taskId)      — replay path (Iterate B)
 *   - await store.has(taskId)       — diagnostic (Iterate A wires this)
 *   - await store.clear(taskId)     — task delete cascade
 */
export class SnapshotStore {
  private readonly fileMode: number;
  private readonly dirMode: number;
  private resolvedDir: string | null = null;

  constructor(
    public readonly dir: string,
    opts: SnapshotStoreOpts = {},
  ) {
    this.fileMode = opts.fileMode ?? 0o600;
    this.dirMode = opts.dirMode ?? 0o700;
  }

  /** Idempotent — creates dir + caches resolved path. */
  async init(): Promise<void> {
    await this.ensureDirResolved();
  }

  /**
   * Write a snapshot atomically (temp file + fs.rename). Existing
   * snapshot for the same task is overwritten. Caller MUST pass cols/rows
   * matching the headless-mirror's current dimensions; we embed them in
   * the header verbatim.
   */
  async write(
    taskId: string,
    payload: { cols: number; rows: number; data: string },
  ): Promise<void> {
    this.validateTaskId(taskId);
    const dir = await this.ensureDirResolved();
    const final = await this.resolveTargetPath(taskId);
    const tmp = path.join(dir, `${taskId}.snapshot.tmp-${process.pid}-${Date.now()}`);

    const terminalVersion = await readTerminalVersion();
    const header =
      `# shipwright-snapshot v1 xterm@${terminalVersion} ${payload.cols}x${payload.rows}\n`;
    const body = header + payload.data;

    await fsAsync.writeFile(tmp, body, { encoding: "utf8", mode: this.fileMode });
    try {
      await fsAsync.rename(tmp, final);
    } catch (err) {
      // Clean up the tmp file if rename failed (e.g. EBUSY mid-flight).
      try {
        await fsAsync.unlink(tmp);
      } catch {
        /* best-effort */
      }
      throw err;
    }
  }

  /**
   * Read + parse the snapshot. Returns null if absent (ENOENT).
   * Throws SnapshotStoreError on malformed header / unknown version.
   */
  async read(taskId: string): Promise<SnapshotRecord | null> {
    this.validateTaskId(taskId);
    const target = await this.resolveTargetPath(taskId);
    let raw: string;
    try {
      raw = await fsAsync.readFile(target, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return parseSnapshotEnvelope(raw);
  }

  /** Existence probe — does not read or parse. */
  async has(taskId: string): Promise<boolean> {
    this.validateTaskId(taskId);
    const target = await this.resolveTargetPath(taskId);
    try {
      await fsAsync.stat(target);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  /** Delete the snapshot file. Idempotent. */
  async clear(taskId: string): Promise<void> {
    this.validateTaskId(taskId);
    const target = await this.resolveTargetPath(taskId);
    try {
      await fsAsync.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  // --- internals ----------------------------------------------------------

  private validateTaskId(taskId: string): void {
    if (!UUID_PATTERN.test(taskId)) {
      throw new SnapshotStoreError(
        "invalid_task_id",
        `taskId does not match UUID pattern: ${taskId}`,
      );
    }
  }

  /**
   * Realpath-at-op-time guard. Mirrors scrollback-store.resolveTaskFile.
   * If the resolved target is outside the snapshot dir, throw.
   * ENOENT is OK (target doesn't exist yet — write will create it).
   */
  private async resolveTargetPath(taskId: string): Promise<string> {
    const dir = await this.ensureDirResolved();
    const candidate = path.join(dir, `${taskId}.snapshot`);
    let real: string;
    try {
      real = await fsAsync.realpath(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw err;
    }
    const rel = path.relative(dir, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new SnapshotStoreError(
        "snapshot_path_outside_dir",
        `realpath escape for ${taskId}: ${real}`,
      );
    }
    return real;
  }

  private async ensureDirResolved(): Promise<string> {
    if (this.resolvedDir) return this.resolvedDir;
    await fsAsync.mkdir(this.dir, { recursive: true, mode: this.dirMode });
    this.resolvedDir = await fsAsync.realpath(this.dir);
    return this.resolvedDir;
  }
}

/**
 * Parse a snapshot envelope. Exported for unit tests.
 *
 * Accepts:
 *   `# shipwright-snapshot <version> xterm@<terminalVersion> <cols>x<rows>\n<data>`
 *
 * Rejects unknown versions, missing fields, non-integer dims. Trailing
 * data after the first `\n` is the payload (preserved verbatim including
 * its own newlines).
 */
export function parseSnapshotEnvelope(raw: string): SnapshotRecord {
  const newlineIdx = raw.indexOf("\n");
  if (newlineIdx < 0) {
    throw new SnapshotStoreError(
      "malformed_header",
      "snapshot envelope has no newline after header",
    );
  }
  // External review OpenAI #12 — bound header size. A real header is
  // ~50 bytes; anything past 512 is malformed or hostile.
  if (newlineIdx > 512) {
    throw new SnapshotStoreError(
      "malformed_header",
      `snapshot header exceeds 512 bytes (got ${newlineIdx})`,
    );
  }
  const headerLine = raw.slice(0, newlineIdx);
  const data = raw.slice(newlineIdx + 1);

  // Header shape: `# shipwright-snapshot <version> xterm@<ver> <cols>x<rows>`
  // Bounded sub-patterns (per ReDoS-resistance discipline from
  // scrollback-store.ts):
  //   - version: `v\d{1,3}` (v0..v999)
  //   - terminalVersion: up to 64 non-whitespace chars
  //   - dims: up to 5-digit cols + rows (caps match HeadlessMirror's
  //     MAX_COLS=1000, MAX_ROWS=500, both 4-digit; 5 digits absorbs
  //     future bumps).
  const re =
    /^# shipwright-snapshot (v\d{1,3}) xterm@(\S{1,64}) (\d{1,5})x(\d{1,5})$/;
  const m = re.exec(headerLine);
  if (!m) {
    throw new SnapshotStoreError(
      "malformed_header",
      `snapshot header does not match expected shape: ${headerLine}`,
    );
  }
  const version = m[1];
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new SnapshotStoreError(
      "unknown_version",
      `Unknown snapshot version: ${version}`,
    );
  }
  const cols = parseInt(m[3], 10);
  const rows = parseInt(m[4], 10);
  // External code review MEDIUM: reject 0x0 and out-of-band dims so
  // downstream consumers (Iterate B replay path) can trust the values
  // without re-validating. Caps match HeadlessMirror.MAX_COLS/MAX_ROWS.
  if (cols <= 0 || rows <= 0 || cols > 1000 || rows > 500) {
    throw new SnapshotStoreError(
      "malformed_header",
      `snapshot dims out of range: ${cols}x${rows} (allowed 1..1000 cols, 1..500 rows)`,
    );
  }
  return {
    version: version as "v1",
    terminalVersion: m[2],
    cols,
    rows,
    data,
  };
}
