/**
 * claude-cli.mjs — the OS-touching default seams for plugins.mjs.
 *
 * Split out (like deploy-procs.mjs vs kill-targets.js) so plugins.mjs stays
 * pure and fully unit-testable. Everything here talks to the real `claude`
 * binary, the real `~/.claude/plugins/` tree, or the network — and every one
 * of them is injectable, so tests never touch any of it.
 *
 * ARCHITECTURE FENCE: this drives the `claude` PLUGIN CLI as an installer. It
 * NEVER starts a `claude` session and never writes `~/.claude/projects/**`,
 * `shipwright_run_config.json`, or `run_loop_state.json` (CLAUDE.md rule 1 /
 * DO-NOT #12). The only verbs used are `plugin marketplace …` and `plugin
 * install|update …`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { MANIFEST_RAW_URL, buildInstalledMap } from "./plugins.mjs";

const SAFE_ARG = /^[A-Za-z0-9@._/:-]+$/;

/**
 * Run the real `claude` CLI. On Windows `claude` is a `.cmd` shim, which
 * shell:false can't resolve (PATHEXT is ignored — the same npm.cmd trap this
 * repo hit before), so Windows goes through the shell. Args are whitelisted to
 * a safe charset first, so shelling out cannot smuggle a metacharacter.
 * @param {string[]} args
 */
export function defaultRunClaude(args) {
  for (const a of args) {
    if (!SAFE_ARG.test(a)) {
      return { ok: false, code: null, stdout: "", stderr: `refused unsafe claude arg: ${a}` };
    }
  }
  const isWin = process.platform === "win32";
  // Every arg is charset-gated by SAFE_ARG (rejects all cmd.exe metacharacters
  // incl. %) before this call; shell:true is Windows-only .cmd/PATHEXT
  // resolution, so there is no injection surface. Semgrep false positive.
  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
  const r = spawnSync("claude", args, { encoding: "utf-8", shell: isWin, timeout: 120_000 });
  return {
    ok: r.status === 0 && !r.error,
    code: r.status ?? null,
    stdout: (r.stdout ?? "").toString(),
    stderr: (r.stderr ?? "").toString(),
  };
}

/** `~/.claude/plugins` root (override via CLAUDE_PLUGINS_ROOT for tests). */
export function pluginsRoot(env = process.env, home = os.homedir()) {
  return env.CLAUDE_PLUGINS_ROOT || path.join(home, ".claude", "plugins");
}

export function installedPluginsPath(env, home) {
  return path.join(pluginsRoot(env, home), "installed_plugins.json");
}

export function marketplaceDir(env, home) {
  return path.join(pluginsRoot(env, home), "marketplaces", "shipwright");
}

export function cacheRoot(env, home) {
  return path.join(pluginsRoot(env, home), "cache", "shipwright");
}

/** Read + parse installed_plugins.json into a `{ name: version }` map (empty on any error). */
export function defaultSnapshotInstalled(env = process.env, home = os.homedir()) {
  try {
    const raw = readFileSync(installedPluginsPath(env, home), "utf-8");
    return buildInstalledMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Precedence 1 — the local marketplace clone materialised by `marketplace add`. */
export function defaultReadLocalManifest(env = process.env, home = os.homedir()) {
  const p = path.join(marketplaceDir(env, home), ".claude-plugin", "marketplace.json");
  try {
    if (!existsSync(p)) return null;
    return { text: readFileSync(p, "utf-8"), source: p };
  } catch {
    return null;
  }
}

/** Precedence 2 — GitHub raw. Offline-safe: any failure resolves to null. */
export function makeFetchRemoteManifest(deps = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : undefined,
    url = MANIFEST_RAW_URL,
    timeoutMs = 4000,
  } = deps;
  return async () => {
    if (!fetchImpl) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      if (!res || !res.ok) return null;
      return { text: await res.text(), source: url };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Precedence 3 — explicit path override (also the test seam). */
export function defaultReadOverrideManifest(env = process.env) {
  const p = env.SHIPWRIGHT_MARKETPLACE_MANIFEST;
  if (!p) return null;
  // A set-but-unreadable override is an OPERATOR error, not a fall-through:
  // surface it loudly rather than silently sliding to "no list".
  return { text: readFileSync(p, "utf-8"), source: p };
}

/** Bundle the three resolver seams with their real implementations. */
export function defaultResolverSeams(deps = {}) {
  const env = deps.env ?? process.env;
  const home = deps.home ?? os.homedir();
  return {
    readLocalManifest: () => defaultReadLocalManifest(env, home),
    fetchRemoteManifest: makeFetchRemoteManifest(deps),
    readOverrideManifest: () => defaultReadOverrideManifest(env),
  };
}
