/*
 * event-log-files.ts — the working-tree loader for `event-log-assemble.ts`.
 *
 * Lists the legacy `shipwright_events.jsonl`, then `shipwright_events.archive/*.jsonl`
 * and `shipwright_events.d/*.jsonl` (each by name; `shipwright_events.quarantine/`
 * is never read), reads each file with one bounded descriptor and hands them to
 * the pure assembler. Same rules as Python `events_log.event_files`: regular files
 * only (no symlinks, no directories), `*.jsonl` names only (the writer's temp
 * files end in `.tmp`; a dot name is read, as Python's glob does),
 * a symlinked folder is not followed. Drops are LISTED before the archive and the
 * whole listing is redone when a listed file vanished before it was read (a
 * release fold adds its archive file first and deletes the drops after), so a fold
 * racing a read never loses an event; the vanished file keeps `unreadable`.
 *
 * Read-only: the WebUI never writes any of these files.
 */

import { lstatSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  ARCHIVE_DIR,
  assembleEventLog,
  dropKey,
  DROPS_DIR,
  EVENT_FILE,
  type AssembledEventLog,
  type EventFileKind,
  type EventSource,
} from "./event-log-assemble.js";
import { readBoundedFile } from "./mission-context/fs-read.js";
import { pathGuard } from "./path-guard.js";

/** Same ceiling the Mission index has always given the legacy log. */
export const MAX_EVENT_FILE_BYTES = 64 * 1024 * 1024;
const VANISH_RETRIES = 2;

interface Listed {
  rel: string;
  absolute: string;
  kind: EventFileKind;
}

/**
 * The folder's `*.jsonl` files. A folder that EXISTS but cannot be listed (permissions,
 * an I/O error) comes back as `failed`, so the caller reports it instead of reading it
 * as "no files" — an unlistable drops folder must never let a run read as absent.
 */
function listFolder(projectRoot: string, dir: string, kind: EventFileKind): { files: Listed[]; failed: boolean } {
  const guard = pathGuard(projectRoot, dir);
  if (!guard.ok) return { files: [], failed: false };
  try {
    if (lstatSync(guard.absolute).isSymbolicLink()) return { files: [], failed: false };
    const files = readdirSync(guard.absolute, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
      .map((d) => d.name)
      .sort()
      .map((name) => ({ rel: `${dir}/${name}`, absolute: path.join(guard.absolute, name), kind }));
    return { files, failed: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    // absent folder (the legacy layout) or a plain file in its place: nothing to read
    return { files: [], failed: code !== "ENOENT" && code !== "ENOTDIR" };
  }
}

/** Legacy (when present), then archive, then drops — the assembler's source order. */
function listEventFiles(projectRoot: string): { legacy: Listed | null; extra: Listed[]; failedDirs: Listed[] } {
  const guard = pathGuard(projectRoot, EVENT_FILE);
  const dropList = listFolder(projectRoot, DROPS_DIR, "drop"); // drops BEFORE the archive (fold race)
  const archiveList = listFolder(projectRoot, ARCHIVE_DIR, "archive");
  const drops = dropList.files;
  const archive = archiveList.files;
  const failedDirs: Listed[] = [];
  if (archiveList.failed) failedDirs.push({ rel: ARCHIVE_DIR, absolute: path.join(projectRoot, ARCHIVE_DIR), kind: "archive" });
  if (dropList.failed) failedDirs.push({ rel: DROPS_DIR, absolute: path.join(projectRoot, DROPS_DIR), kind: "drop" });
  let legacy: Listed | null = null;
  if (guard.ok) {
    try {
      statSync(guard.absolute);
      legacy = { rel: EVENT_FILE, absolute: guard.absolute, kind: "legacy" };
    } catch {
      legacy = null; // absent legacy log: not listed (Python lists it but never reads an absent one)
    }
  }
  return { legacy, extra: [...archive, ...drops], failedDirs };
}

export interface LoadedEventLog extends AssembledEventLog {
  /** True when neither the legacy log nor any archive/drop file exists. */
  absent: boolean;
}

/**
 * Read and assemble the tree's event log, or `null` when the legacy log exists
 * but cannot be read (or the root is guarded out) — exactly what every reader
 * treated as "unreadable" before the drop folders existed (Python raises there).
 */
export function readAssembledEventLog(projectRoot: string): LoadedEventLog | null {
  if (!pathGuard(projectRoot, EVENT_FILE).ok) return null;
  const lost = new Set<string>();
  for (let attempt = 0; ; attempt++) {
    const { legacy, extra, failedDirs } = listEventFiles(projectRoot);
    const sources: EventSource[] = [];
    if (legacy) {
      const read = readBoundedFile(legacy.absolute, MAX_EVENT_FILE_BYTES);
      if (!read) return null;
      sources.push({ path: legacy.rel, kind: "legacy", text: read.text });
    }
    let vanished = false;
    for (const f of extra) {
      const read = readBoundedFile(f.absolute, MAX_EVENT_FILE_BYTES);
      if (!read && !exists(f.absolute)) {
        vanished = true;
        lost.add(f.rel);
      }
      sources.push({ path: f.rel, kind: f.kind, text: read ? read.text : null });
    }
    if (vanished && attempt < VANISH_RETRIES) continue;
    // An unlistable folder is one `unreadable` source (key null for drops → it blocks every
    // run's absence verdict, the same fail-closed rule as an odd-named damaged drop).
    for (const dir of failedDirs) sources.push({ path: dir.rel, kind: dir.kind, text: null });
    const assembled = assembleEventLog(sources);
    // A file lost to a fold keeps its `unreadable` row, so its run's absence gate still fails closed.
    for (const rel of lost) {
      if (!assembled.files.some((s) => s.path === rel)) {
        const drop = rel.startsWith(`${DROPS_DIR}/`);
        assembled.files.push({ path: rel, kind: drop ? "drop" : "archive",
          key: drop ? dropKey(path.posix.basename(rel)) : null, status: "unreadable", records: 0, fragments: 0 });
      }
    }
    return { ...assembled, absent: legacy === null && extra.length === 0 && failedDirs.length === 0 };
  }
}

function exists(absolute: string): boolean {
  try {
    statSync(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap change marker for caches: every listed file's (path, mtime, size). A folder's
 * own mtime does not move when a file in it is APPENDED, so the files themselves count.
 */
export function eventLogFingerprint(projectRoot: string): string {
  const { legacy, extra, failedDirs } = listEventFiles(projectRoot);
  const parts: string[] = failedDirs.map((d) => `${d.rel}:unlistable`);
  for (const f of legacy ? [legacy, ...extra] : extra) {
    try {
      const st = statSync(f.absolute);
      parts.push(`${f.rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${f.rel}:absent`);
    }
  }
  return parts.join("|");
}

/** Every path whose stat must move a `sourceRev`: the log, both folders, every listed file. */
export function eventLogRevPaths(projectRoot: string): string[] {
  const { extra } = listEventFiles(projectRoot);
  return [
    path.join(projectRoot, EVENT_FILE),
    path.join(projectRoot, DROPS_DIR),
    path.join(projectRoot, ARCHIVE_DIR),
    ...extra.map((f) => f.absolute),
  ];
}
