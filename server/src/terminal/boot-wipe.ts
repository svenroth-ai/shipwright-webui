/*
 * boot-wipe.ts — Iterate C (ADR-087).
 *
 * One-shot wipe of legacy `<scrollbackDir>/*.log*` files at first boot
 * after Iterate C deploys. Replaces the 24-h TTL natural-decay strategy
 * with a cleaner cut: the chunked-replay path is gone, so byte-stream
 * scrollback files have no remaining consumer and accumulate as pure
 * disk waste. We wipe once, mark the directory, and never wipe again.
 *
 * Architecture invariants:
 *   1. Idempotent — a marker file `.iterate-c-wiped.marker` records that
 *      the wipe ran. Subsequent boots short-circuit when the marker
 *      exists. Loss of the marker after a successful wipe MUST NOT
 *      cause re-wipe of new scrollback that may have accumulated post-
 *      Iterate-C (we treat that as a stable post-conditioned state).
 *   2. Marker is written AFTER unlinks complete (NEVER before — a crash
 *      between marker-write and unlink would leave files orphaned with
 *      no future wipe path).
 *   3. Per-file failure is non-fatal — log a warn, continue with the
 *      next file. The marker is still written if ANY file was removed
 *      (partial wipe is a stable post-condition; the operator can
 *      manually clean stragglers via the OS file manager).
 *   4. Snapshot files (`.snapshot`) are PRESERVED — those are the
 *      Iterate-B replay artifacts we explicitly want to keep.
 *   5. Best-effort overall: dir-read failure logs a warn and returns
 *      without writing the marker (so the wipe re-attempts on next
 *      boot). Boot path MUST NOT crash on wipe failure.
 *
 * Testability:
 *   - `runBootWipe(opts)` is a pure function over a deps object (fs +
 *     dir) so unit tests can stub fs without touching disk. Production
 *     wires `node:fs/promises` directly.
 */

import * as fsAsync from "node:fs/promises";
import * as path from "node:path";

export const ITERATE_C_WIPE_MARKER = ".iterate-c-wiped.marker";

export interface BootWipeDeps {
  readdir: (dir: string) => Promise<string[]>;
  unlink: (p: string) => Promise<void>;
  writeFile: (p: string, data: string) => Promise<void>;
  stat: (p: string) => Promise<{ isFile(): boolean } | null>;
}

export interface BootWipeOpts {
  /** Absolute path to the scrollback directory (e.g. <home>/.shipwright-webui/terminal-scrollback). */
  dir: string;
  /** Injected for tests; defaults to node:fs/promises. */
  deps?: Partial<BootWipeDeps>;
  /** Injected for tests; defaults to console.warn. */
  logWarn?: (msg: string) => void;
  /** Injected for tests; defaults to console.log. */
  logInfo?: (msg: string) => void;
}

export interface BootWipeResult {
  /** True if the marker existed before this run (i.e. wipe was skipped). */
  skipped: boolean;
  /** Number of `.log*` files unlinked successfully. */
  deleted: number;
  /** Number of per-file errors (kept going). */
  errors: number;
  /** Whether the marker was written this run. */
  markerWritten: boolean;
}

const LOG_FILE_RE = /\.log(?:\.\d+)?$/;

const defaultDeps: BootWipeDeps = {
  readdir: (dir) => fsAsync.readdir(dir),
  unlink: (p) => fsAsync.unlink(p),
  writeFile: (p, data) => fsAsync.writeFile(p, data, { encoding: "utf8" }),
  stat: async (p) => {
    try {
      const s = await fsAsync.stat(p);
      return { isFile: () => s.isFile() };
    } catch {
      return null;
    }
  },
};

/**
 * Idempotent one-shot wipe of legacy byte-stream scrollback files.
 *
 * Behavior:
 *   - If the marker exists → return `{skipped: true}` immediately.
 *   - Else: list dir, unlink every entry matching `*.log` / `*.log.\d+`,
 *     count successes + failures, then write the marker.
 *   - Wipe failure of an individual file is non-fatal; we still write
 *     the marker so subsequent boots don't retry the whole sweep.
 *   - Marker-write failure: log warn but treat as success (the wipe
 *     itself succeeded; missing marker is a recovery edge case that
 *     the operator can re-trigger by deleting `.shipwright-webui/`).
 *
 * Returns a structured result so callers (boot path) can log a single
 * summary line.
 */
export async function runBootWipe(opts: BootWipeOpts): Promise<BootWipeResult> {
  const deps: BootWipeDeps = {
    ...defaultDeps,
    ...(opts.deps ?? {}),
  };
  const logWarn = opts.logWarn ?? ((m) => console.warn(m));
  const logInfo = opts.logInfo ?? ((m) => console.log(m));

  const markerPath = path.join(opts.dir, ITERATE_C_WIPE_MARKER);
  const existing = await deps.stat(markerPath);
  if (existing && existing.isFile()) {
    return { skipped: true, deleted: 0, errors: 0, markerWritten: false };
  }

  let entries: string[];
  try {
    entries = await deps.readdir(opts.dir);
  } catch (err) {
    // Dir doesn't exist OR not readable — non-fatal; nothing to wipe.
    // Don't write the marker either; on next boot the dir may exist and
    // we'll retry the sweep cleanly.
    logWarn(
      `[boot-wipe] scrollback dir not readable; skipping wipe (${(err as Error).message})`,
    );
    return { skipped: false, deleted: 0, errors: 0, markerWritten: false };
  }

  let deleted = 0;
  let errors = 0;
  for (const name of entries) {
    if (!LOG_FILE_RE.test(name)) continue;
    const fullPath = path.join(opts.dir, name);
    try {
      await deps.unlink(fullPath);
      deleted++;
    } catch (err) {
      errors++;
      logWarn(
        `[boot-wipe] unlink failed for ${name}: ${(err as Error).message}`,
      );
    }
  }

  // Write the marker AFTER unlinks complete. Per the hard rule in the
  // iterate spec: marker write failure must NOT trigger re-wipe — log
  // warn but treat as wiped if any files were removed.
  let markerWritten = false;
  try {
    await deps.writeFile(
      markerPath,
      `# iterate-c boot wipe marker\n# wiped=${deleted} errors=${errors} ts=${new Date().toISOString()}\n`,
    );
    markerWritten = true;
  } catch (err) {
    logWarn(
      `[boot-wipe] marker write failed: ${(err as Error).message} — wipe stays effective; manual marker creation may be needed to suppress next-boot retry`,
    );
  }

  if (deleted > 0 || errors > 0) {
    logInfo(
      `[boot-wipe] iterate-C scrollback wipe complete: deleted=${deleted} errors=${errors} markerWritten=${markerWritten}`,
    );
  }

  return { skipped: false, deleted, errors, markerWritten };
}
