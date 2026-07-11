/*
 * project-registry-io.ts — F07 (D08): corrupt-file tolerance + atomic write
 * for the projects.json registry read/write path.
 *
 * ProjectManager.load() previously ran a bare JSON.parse with zero corrupt-file
 * tolerance, while its writers are non-atomic fire-and-forget persists. A
 * force-kill (the documented `taskkill` dev workflow), a power loss, or a
 * tsx-watch restart landing mid-persist truncates projects.json — which then
 * made the server exit FATAL on EVERY subsequent boot with an unattributed
 * parse error.
 *
 * These helpers are factored out of project-manager.ts (which sits at its bloat
 * ceiling) and mirror the sdk-sessions-store recovery pattern:
 *   • empty / whitespace-only  → treat as an empty registry (nothing to save).
 *   • unreadable (transient EBUSY/EPERM/EACCES lock, or a permission error) →
 *     retry on the rule-6 budget, then degrade to an empty registry — a boot
 *     load must never throw-and-brick.
 *   • unparseable / wrong-shape → quarantine the bytes aside
 *     (`.corrupt-<ts>-<uuid>`) and continue with an empty registry.
 *   • persist → stage to `<path>.tmp-<uuid>` then rename into place (retried on
 *     a transient lock; the tmp is unlinked on a hard failure), so a force-kill
 *     mid-write lands on the throwaway tmp, never truncating the live file
 *     (shrinking the corruption window at the source).
 */

import { randomUUID } from "crypto";
import { unlink as fsUnlink } from "node:fs/promises";

import type { Project } from "../types/project.js";

/** fs error `code`s that are transient on Windows — retried (CLAUDE.md rule 6). */
const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * Retry a transient (EBUSY/EPERM/EACCES) fs op up to 6× with 50→1600 ms backoff
 * — the torn-read budget from CLAUDE.md rule 6 / `core/session-watcher.ts`,
 * replicated here (sdk-sessions-merge's copy is module-private). A non-transient
 * error, or exhaustion after 6 attempts, re-throws for the caller to handle.
 */
async function withFsRetry<T>(op: () => Promise<T>): Promise<T> {
  let delay = 50;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !RETRYABLE_FS_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1600);
    }
  }
}

/** The narrow fs surface these helpers need — structurally satisfied by ProjectManagerDeps. */
export interface RegistryIoDeps {
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
  /**
   * Optional atomic rename (`fs.promises.rename` in production). When absent
   * (unit doubles that write to an in-memory store) atomicity is impossible,
   * so the write falls back to a plain in-place write and the quarantine
   * copies the bytes aside via writeFile instead of renaming.
   */
  rename?: (from: string, to: string) => Promise<void>;
}

export type RegistryParse =
  | { kind: "empty" }
  | { kind: "corrupt" }
  | { kind: "projects"; projects: Project[] };

/**
 * Read + parse projects.json into an id→Project map, tolerating corruption.
 * Ensures the parent dir exists; a missing registry is created empty (`[]`);
 * empty/whitespace content yields an empty map; a corrupt file is quarantined
 * aside (see quarantineCorruptRegistry) and yields an empty map — so a
 * truncated projects.json can never make the server exit FATAL on boot (F07).
 */
export async function loadProjectRegistry(
  deps: RegistryIoDeps,
  registryPath: string,
): Promise<Map<string, Project>> {
  const projects = new Map<string, Project>();
  const dir = registryPath.substring(0, registryPath.lastIndexOf("/"));
  if (dir && !deps.existsSync(dir)) deps.mkdirSync(dir, { recursive: true });
  if (!deps.existsSync(registryPath)) {
    await deps.writeFile(registryPath, "[]");
    return projects;
  }
  // A boot-time load must NEVER throw-and-brick. existsSync already passed, so a
  // transient Windows lock (EBUSY/EPERM/EACCES — the same force-kill class F07
  // targets) or a permission error here would otherwise be FATAL. Retry the read
  // on the transient codes (rule 6); a PERSISTENT failure degrades to an empty
  // registry — the next persist rewrites a fresh file. (Unlike D04's reReadDisk,
  // which rejects a *persist* on read failure to avoid clobbering a peer; this is
  // a boot load with nothing to clobber, so degrade-to-empty is correct.)
  let content: string;
  try {
    content = await withFsRetry(() => deps.readFile(registryPath, "utf-8"));
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message:
          "projects.json could not be read — starting with an empty registry",
        registryPath,
        error: String(err),
      }),
    );
    return projects;
  }
  const parsed = parseProjectRegistry(content);
  if (parsed.kind === "corrupt") {
    await quarantineCorruptRegistry(deps, registryPath, content);
    return projects;
  }
  if (parsed.kind === "projects") {
    for (const p of parsed.projects) {
      if (p && typeof p === "object" && typeof p.id === "string") {
        projects.set(p.id, p);
      }
    }
  }
  return projects;
}

/**
 * Classify raw projects.json bytes without throwing. Empty / whitespace-only
 * is a legitimately-empty registry; unparseable JSON or a non-array root is
 * corrupt (a `for..of` over a non-array would throw). A well-formed array
 * returns its rows for the caller to index.
 */
export function parseProjectRegistry(content: string): RegistryParse {
  if (!content.trim()) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { kind: "corrupt" };
  }
  if (!Array.isArray(parsed)) return { kind: "corrupt" };
  return { kind: "projects", projects: parsed as Project[] };
}

/**
 * Move a corrupt/unparseable projects.json out of the way so a fresh empty
 * registry can take its place, and log which file was at fault plus where the
 * preserved copy lives. Best-effort: a quarantine failure is swallowed so it
 * can never re-brick the boot it is meant to rescue. With a `rename` dep
 * (production) the file is renamed aside — cleaner, because the original path
 * is then absent and the next persist writes a fresh file; with no rename dep
 * (unit doubles) the bytes are copied aside via writeFile so the content is
 * still preserved for manual recovery.
 */
export async function quarantineCorruptRegistry(
  deps: RegistryIoDeps,
  registryPath: string,
  content: string,
): Promise<void> {
  // `-${randomUUID()}` guards against a same-millisecond collision clobbering a
  // prior aside copy (rapid restart loops / repeated recovery attempts).
  const asidePath = `${registryPath}.corrupt-${Date.now()}-${randomUUID()}`;
  const rename = deps.rename;
  let quarantined = false;
  try {
    if (rename) {
      // Retry a transient lock on the aside rename (rule 6) before giving up.
      await withFsRetry(() => rename(registryPath, asidePath));
    } else {
      await deps.writeFile(asidePath, content);
    }
    quarantined = true;
  } catch {
    // Best-effort — never let a quarantine failure re-throw on boot.
  }
  console.error(
    JSON.stringify({
      level: "error",
      // Only claim an aside path when the copy actually landed (the log's
      // "where the copy lives" must not point at a file that was never written).
      message: quarantined
        ? "projects.json was corrupt or unparseable — quarantined aside; starting with an empty registry"
        : "projects.json was corrupt or unparseable and could NOT be quarantined — starting with an empty registry",
      registryPath,
      quarantinedTo: quarantined ? asidePath : null,
    }),
  );
}

/**
 * Write the registry atomically: stage to a throwaway `<path>.tmp-<uuid>` then
 * rename it into place. `fs.rename` is atomic and replaces the destination on
 * both POSIX and Windows, so a force-kill mid-write lands on the tmp file and
 * never truncates the live registry.
 *
 * With no `rename` dep (unit doubles) atomicity is impossible, so fall back to
 * a plain in-place write — the exact prior behaviour. A transient rename
 * failure is self-healing: the caller's persist() is fire-and-forget with an
 * in-memory Map that stays authoritative, and the next mutation re-persists.
 */
export async function atomicWriteRegistry(
  deps: RegistryIoDeps,
  registryPath: string,
  data: string,
): Promise<void> {
  const rename = deps.rename;
  if (!rename) {
    await deps.writeFile(registryPath, data);
    return;
  }
  const tmp = `${registryPath}.tmp-${randomUUID()}`;
  await deps.writeFile(tmp, data);
  try {
    // Retry a transient lock on the rename (rule 6); on a hard failure clean up
    // the staged tmp so it can't orphan on disk, then re-throw for the caller.
    await withFsRetry(() => rename(tmp, registryPath));
  } catch (err) {
    try {
      await fsUnlink(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}
