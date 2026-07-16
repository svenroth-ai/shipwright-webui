/**
 * cache-runtime.mjs — compose the pure cache-sync steps over the real
 * `~/.claude/plugins/` tree. Reads installed_plugins.json to resolve each
 * plugin's exact installed version dir (never a version compare — a full file
 * sync "regardless of version number", exactly as update-marketplace.sh does),
 * runs the make-or-break shared/ sync + the plugins/ layer + stale-version GC,
 * then returns the AC1b coherence verdict.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { cacheRoot, marketplaceDir, installedPluginsPath } from "./claude-cli.mjs";
import {
  syncSharedTree,
  syncPluginCache,
  ensurePluginsLayer,
  gcStaleVersionDirs,
  verifyCacheCoherent,
} from "./cache-sync.mjs";

/** Parsed installed_plugins.json, or `{ plugins: {} }` on any error. */
export function readInstalledPluginsJson(env = process.env, home = os.homedir()) {
  try {
    return JSON.parse(readFileSync(installedPluginsPath(env, home), "utf-8"));
  } catch {
    return { plugins: {} };
  }
}

/** First installed entry (`installPath` + `version`) for a plugin, or null. */
export function resolveInstalledEntry(installedJson, name) {
  const entries = installedJson?.plugins?.[`${name}@shipwright`];
  const first = Array.isArray(entries) ? entries[0] : null;
  if (!first || typeof first.installPath !== "string") return null;
  return { installPath: path.normalize(first.installPath), version: first.version };
}

/**
 * Run the full cache sync for a resolved plugin-name list.
 * @param {{ names: string[], env?: NodeJS.ProcessEnv, home?: string, log?: (m:string)=>void }} opts
 * @returns {{ cacheRoot: string, shared: object, syncedCount: number, verdict: {ok:boolean, problems:string[]} }}
 */
export function runCacheSync({ names, env = process.env, home = os.homedir(), log = () => {} }) {
  const mkt = marketplaceDir(env, home);
  const cache = cacheRoot(env, home);
  const installedJson = readInstalledPluginsJson(env, home);

  // 1. THE make-or-break step: shared/ into the cache root.
  const shared = syncSharedTree(mkt, cache);
  log(`  shared/: ${shared.added} added, ${shared.changed} updated, ${shared.removed} removed`);

  // 2. Per-plugin full file sync + plugins/ layer + stale-version GC.
  const pluginVersionDirs = [];
  let syncedCount = 0;
  for (const name of names) {
    const entry = resolveInstalledEntry(installedJson, name);
    if (!entry || !existsSync(entry.installPath)) continue;
    syncPluginCache(mkt, name, entry.installPath);
    ensurePluginsLayer(name, entry.installPath, cache);
    gcStaleVersionDirs(name, cache, entry.version);
    pluginVersionDirs.push({ name, versionDir: entry.installPath });
    syncedCount++;
  }

  // 3. Post-condition coherence verdict (AC1b) — validated against the FULL
  //    manifest set, so a plugin that failed to install (no version dir) is a
  //    loud incoherence, never a silently-skipped "coherent" pass.
  const verdict = verifyCacheCoherent({ cacheRoot: cache, pluginVersionDirs, requestedNames: names });
  return { cacheRoot: cache, shared, syncedCount, verdict };
}
