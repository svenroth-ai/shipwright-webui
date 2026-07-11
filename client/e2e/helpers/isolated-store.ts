/*
 * Isolated sdk-sessions store helper for the ADR-038 schema E2E guards
 * (specs 62 + 70-g). D05 / F19 + F20.
 *
 * ⚠️ SAFETY — Guard 1 (isolation self-lock, the primary safety net).
 * Both schema specs mutate `sdk-sessions.json` on disk. That file is the
 * persistent task store; the REAL one lives at
 * `~/.shipwright-webui/sdk-sessions.json` and MUST NEVER be touched by a
 * test. If a spec naively "fixed" the path it would strip `projectId` from
 * every row of the user's real store and downgrade it to v1 — destroying it.
 *
 * These helpers resolve the store path from the process env
 * (`USERPROFILE` on win32 / `HOME` on posix — exactly what the server's
 * `os.homedir()`-derived `registryDir` keys off, server/src/config.ts:109)
 * and HARD-ABORT (throw) BEFORE any read or write unless the resolved store
 * sits under the OS temp dir. A fumbled isolated-stack env (USERPROFILE not
 * overridden) then fails loudly here instead of degrading the real store.
 *
 * The specs run ONLY against an isolated temp-USERPROFILE stack: the
 * operator boots Hono + Vite with `USERPROFILE` (win32) / `HOME` (posix)
 * pointed at a throwaway dir under `os.tmpdir()`, so the server's
 * registryDir becomes `<temp>/.shipwright-webui`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The store's CURRENT on-disk schema version. Duplicated here so the specs
 * assert the live value instead of a stale literal, WITHOUT a cross-package
 * import (ADR-080). Mirrors server/src/core/sdk-sessions-store.ts
 * CURRENT_SCHEMA_VERSION (ADR-038; bumped to 4 by iterate-2026-06-17
 * boardColumn). If the server bumps it, this must be updated in lockstep.
 */
export const EXPECTED_SCHEMA_VERSION = 4;

/**
 * Reserved projectId sentinel for the "Unassigned" bucket. Mirrors
 * server/src/core/sdk-sessions-store.ts UNASSIGNED_PROJECT_ID +
 * client/src/lib/projectIds.ts (intentional duplication per conventions.md;
 * the two package halves do not import each other — ADR-080).
 */
export const UNASSIGNED_PROJECT_ID = "unassigned";

/** On-disk shape of sdk-sessions.json (only the fields the specs read). */
export interface StoreRow {
  taskId?: string;
  title?: string;
  projectId?: string;
  [key: string]: unknown;
}
export interface SdkSessionsFileShape {
  schemaVersion: number;
  sessions: Record<string, StoreRow>;
}

/**
 * Resolve the home dir the server's registryDir keys off. The server reads
 * `os.homedir()`, which on win32 IS `process.env.USERPROFILE` and on posix
 * is `$HOME`; an isolated stack overrides these to a throwaway temp dir.
 */
export function homeFromEnv(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

export function isolatedRegistryDir(): string {
  return path.join(homeFromEnv(), ".shipwright-webui");
}

export function isolatedStorePath(): string {
  return path.join(isolatedRegistryDir(), "sdk-sessions.json");
}

/** Nearest existing ancestor of `p` — lets realpath canonicalize a
 * not-yet-created registryDir via its (existing) temp parent. */
function nearestExistingAncestor(p: string): string {
  let cur = path.resolve(p);
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
  return cur;
}

function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `child` is `parent` itself or nested under it. realpath already
 * canonicalizes case on win32; the lowercase compare is belt-and-suspenders. */
function isUnder(parent: string, child: string): boolean {
  const norm = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  const rel = path.relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Explicit opt-in sentinel the isolated recipe MUST set. Required IN ADDITION
 * to the under-os.tmpdir() check because the tmpdir proxy is blind to a
 * `TEMP=%USERPROFILE%` (win32) / `TMPDIR=$HOME` (posix) layout: on such a box
 * the real `~/.shipwright-webui` IS under os.tmpdir(), so a fumbled run with no
 * home override could otherwise pass. A plain real-machine `npm run test:e2e`
 * never sets this env, so no tmp layout can bypass the self-lock.
 */
export const ISOLATION_SENTINEL_ENV = "SHIPWRIGHT_E2E_ISOLATED";

/**
 * Guard 1 — isolation self-lock. THROW (aborting the spec before any read or
 * write) unless BOTH hold: (a) `SHIPWRIGHT_E2E_ISOLATED === "1"` (the isolated
 * recipe's explicit opt-in), AND (b) the resolved store lives under the OS
 * temp dir. Either one missing → hard-abort, so a mis-configured run
 * (USERPROFILE/HOME not pointed at a temp dir, or a real-machine run that
 * never sets the sentinel) fails loudly here instead of mutating / downgrading
 * the user's real task store. Returns the vetted path so call sites can write
 * `const p = assertIsolatedStore()`.
 */
export function assertIsolatedStore(storePath: string = isolatedStorePath()): string {
  const registryDir = path.dirname(storePath);
  const realAnchor = canonical(nearestExistingAncestor(registryDir));
  const realTmp = canonical(os.tmpdir());
  const sentinelSet = process.env[ISOLATION_SENTINEL_ENV] === "1";
  const underTmp = isUnder(realTmp, realAnchor);
  if (!sentinelSet || !underTmp) {
    throw new Error(
      "[isolated-store SELF-LOCK] Refusing to touch " +
        storePath +
        ": this ADR-038 schema spec (D05) MUST run against an isolated temp " +
        "USERPROFILE/HOME stack. Required: " +
        ISOLATION_SENTINEL_ENV +
        "=1 (set=" +
        String(sentinelSet) +
        ") AND registry dir under the OS temp dir " +
        realTmp +
        " (registryDir=" +
        registryDir +
        ", underTmp=" +
        String(underTmp) +
        "). The sentinel is required IN ADDITION to the tmp check because a " +
        "TEMP=%USERPROFILE% layout can place the real ~/.shipwright-webui " +
        "under os.tmpdir(); a plain real-machine run never sets it, so the " +
        "real store can NEVER be downgraded or mutated.",
    );
  }
  return storePath;
}

/**
 * Read + parse the isolated store. Self-locks first. Returns null if the
 * file does not exist yet (fresh stack, before any task was created).
 */
export function readIsolatedStore(
  storePath: string = isolatedStorePath(),
): SdkSessionsFileShape | null {
  assertIsolatedStore(storePath);
  if (!fs.existsSync(storePath)) return null;
  return JSON.parse(fs.readFileSync(storePath, "utf-8")) as SdkSessionsFileShape;
}

/** Overwrite the isolated store with `data`. Self-locks first + mkdir -p. */
export function writeIsolatedStore(
  data: SdkSessionsFileShape,
  storePath: string = isolatedStorePath(),
): void {
  assertIsolatedStore(storePath);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export interface V1SeedRow {
  taskId: string;
  title: string;
  cwd?: string;
  sessionUuid?: string;
}

/**
 * Build + write a v1-shaped sdk-sessions.json (schemaVersion 1, and NO
 * `projectId` on any row) to the isolated store — the exact shape a
 * pre-ADR-038 binary (or a rollback) would leave on disk. Self-locks first.
 *
 * The server backfills `projectId = UNASSIGNED_PROJECT_ID` for v1 rows via
 * `validateExternalTask` (the v1 load path) the next time it observes the
 * file — either at boot `load()` or, mid-run, when a mutation triggers
 * `persist()`, which re-reads + merges the on-disk rows under the lock. This
 * overwrites the whole file (the throwaway store is disposable); the seeded
 * rows are the migration subjects the spec then asserts on.
 *
 * Single-writer assumption: this plain (unlocked) write is safe because the
 * seed runs before the spec provokes any server persist() — the isolated
 * stack has no concurrent writer racing the file at seed time.
 */
export function seedV1Store(
  rows: V1SeedRow[],
  storePath: string = isolatedStorePath(),
): void {
  const sessions: Record<string, StoreRow> = {};
  for (const r of rows) {
    sessions[r.taskId] = {
      taskId: r.taskId,
      sessionUuid: r.sessionUuid ?? randomUUID(),
      cwd: r.cwd ?? os.tmpdir(),
      pluginDirs: [],
      state: "draft",
      title: r.title,
      createdAt: new Date().toISOString(),
      inbox: {
        pendingToolUseIds: [],
        dismissedToolUseIds: [],
        lastProcessedByteOffset: 0,
      },
      // Deliberately NO `projectId` — that absence IS the v1 shape under test.
    };
  }
  writeIsolatedStore({ schemaVersion: 1, sessions }, storePath);
}
