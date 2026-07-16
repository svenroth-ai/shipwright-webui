#!/usr/bin/env node
/**
 * shipwright.mjs — the ONE command.
 *   npx @svenroth-ai/shipwright@latest
 *
 * Install AND update the whole system — the `/shipwright-*` plugins AND the
 * Command Center — first run and every run after. Order:
 *   self-version check → preflight → plugins (+ cache sync) → server → summary.
 *
 * Honesty rule (AC8): the summary reports ONLY what actually happened. No
 * "plugins active" while a restart is still pending; no success line for a
 * plugin whose install exited non-zero; the restart notice prints EXACTLY when
 * the installed plugin set changed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MARK } from "../lib/util.mjs";
import { checkForStaleCopy, staleBanner } from "../lib/version-check.mjs";
import { runPreflight, renderVerdict } from "../lib/preflight.mjs";
import { ensurePlugins, resolveMarketplacePlugins } from "../lib/plugins.mjs";
import { defaultRunClaude, defaultResolverSeams, defaultSnapshotInstalled } from "../lib/claude-cli.mjs";
import { runCacheSync } from "../lib/cache-runtime.mjs";
import { ensureServer } from "../lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const SELF_VERSION = readSelfVersion();

function readSelfVersion() {
  try {
    return JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function parseArgs(argv) {
  const a = { noOpen: false, pluginsOnly: false, webuiOnly: false, port: undefined, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--no-open") a.noOpen = true;
    else if (t === "--plugins-only") a.pluginsOnly = true;
    else if (t === "--webui-only") a.webuiOnly = true;
    else if (t === "--version" || t === "-v") a.version = true;
    else if (t === "--help" || t === "-h") a.help = true;
    else if (t === "--port") a.port = Number(argv[++i]);
    else if (t.startsWith("--port=")) a.port = Number(t.slice("--port=".length));
  }
  return a;
}

/** The effective port: `--port` wins, else `PORT` env, else 3847. May be NaN. */
export function resolvePort(a, env = process.env) {
  if (a.port !== undefined) return a.port;
  return env.PORT ? Number(env.PORT) : 3847;
}

/** Reject contradictory flags + an out-of-range port (from --port OR PORT). */
export function validateArgs(a, port) {
  if (a.pluginsOnly && a.webuiOnly) {
    return "--plugins-only and --webui-only are mutually exclusive";
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `invalid port ${JSON.stringify(port)}: must be an integer 1-65535 (--port or PORT env)`;
  }
  return null;
}

const HELP = `shipwright — install & update Shipwright (plugins + Command Center)

Usage:
  npx @svenroth-ai/shipwright@latest [options]

Options:
  --no-open        do not open the browser (CI / headless)
  --plugins-only   install/update plugins, skip the Command Center
  --webui-only     boot/attach the Command Center, skip the plugin phase
  --port <n>       Command Center port (default 3847; or PORT env)
  --version, -v    print this package's version
  --help, -h       this help`;

/** Run the plugin phase: preflight-gated install/update + the make-or-break cache sync. */
async function pluginPhase(log) {
  const pre = runPreflight();
  log(renderVerdict(pre, MARK));
  if (!pre.pluginPhaseOk) {
    log(`\n${MARK.fail} Skipping the plugin phase — a hard prerequisite is missing (see above).`);
    log(`${MARK.warn} The Command Center would launch a Claude with NO /shipwright-* commands.`);
    return { skipped: true, exitCode: Math.max(pre.exitCode, 1) };
  }
  log(`\nInstalling / updating plugins from the marketplace manifest...`);
  const seams = defaultResolverSeams();
  const outcome = await ensurePlugins({
    runClaude: defaultRunClaude,
    resolvePlugins: () => resolveMarketplacePlugins(seams),
    snapshotInstalled: () => defaultSnapshotInstalled(),
    log,
  });
  log(`  marketplace ${outcome.marketplaceAction}; ${outcome.names.length} plugin(s) from ${outcome.source}`);

  log(`Syncing the plugin cache (shared/, plugins/ layer, GC)...`);
  const cache = runCacheSync({ names: outcome.names, log });
  if (!cache.verdict.ok) {
    log(`${MARK.fail} Plugin cache is INCOHERENT — hooks would die at session start:`);
    for (const p of cache.verdict.problems.slice(0, 8)) log(`      - ${p}`);
    return { skipped: false, outcome, cacheOk: false, exitCode: 1 };
  }
  log(`${MARK.pass} Plugin cache coherent (${cache.syncedCount} plugin(s), shared/ present).`);
  return { skipped: false, outcome, cacheOk: true, exitCode: outcome.failures.length > 0 ? 1 : 0 };
}

export function printSummary(log, { plugin, server, port }) {
  log(`\n========================================`);
  log(` Shipwright`);
  log(`========================================`);
  if (plugin && !plugin.skipped && plugin.outcome) {
    const o = plugin.outcome;
    const installed = o.results.filter((r) => r.action === "install" && r.ok).map((r) => r.name);
    const updated = o.results.filter((r) => r.action === "update" && r.ok).map((r) => r.name);
    if (installed.length) log(` ${MARK.pass} Installed: ${installed.join(", ")}`);
    if (updated.length) log(` ${MARK.pass} Updated:   ${updated.join(", ")}`);
    for (const f of o.failures) log(` ${MARK.fail} FAILED:    ${f.name}@shipwright (exit ${f.code})`);
    if (plugin.cacheOk === false) log(` ${MARK.fail} Plugin cache incoherent — hooks will not run until re-synced.`);
    // AC5 + AC8: the restart notice prints EXACTLY when the plugin set changed.
    if (o.pluginsChanged) {
      log(``);
      log(` ${MARK.warn} Restart Claude Code — freshly installed/updated plugins only`);
      log(`      activate in a NEW session. This is the one step this tool cannot`);
      log(`      do for you.`);
    }
  }
  if (server) {
    if (server.action === "attach") log(` ${MARK.pass} Command Center already running: ${server.url}`);
    else if (server.action === "boot") log(` ${MARK.pass} Command Center started: ${server.url}`);
    else if (server.action === "swap") log(` ${MARK.pass} Command Center updated to ${server.version}: ${server.url}`);
  } else if (port) {
    log(` ${MARK.skip} Command Center: skipped (--plugins-only).`);
  }
  log(`========================================`);
}

export async function main(argv = process.argv.slice(2), log = (m) => console.log(m)) {
  const args = parseArgs(argv);
  if (args.version) { log(SELF_VERSION); return 0; }
  if (args.help) { log(HELP); return 0; }

  const port = resolvePort(args);
  const invalid = validateArgs(args, port);
  if (invalid) { log(`${MARK.fail} ${invalid}`); return 2; }

  // Self-version check (npx cache trap) — courtesy, never fatal.
  const stale = await checkForStaleCopy(SELF_VERSION);
  const banner = staleBanner(stale);
  if (banner) log(`${MARK.warn} ${banner}\n`);

  let exitCode = 0;
  let plugin = null;
  let server = null;

  if (!args.webuiOnly) {
    plugin = await pluginPhase(log);
    exitCode = Math.max(exitCode, plugin.exitCode ?? 0);
  }

  if (!args.pluginsOnly) {
    try {
      server = await ensureServer({ port, pkgRoot: PKG_ROOT, packageVersion: SELF_VERSION, noOpen: args.noOpen, log });
    } catch (e) {
      log(`${MARK.fail} ${String(e?.message ?? e)}`);
      exitCode = Math.max(exitCode, 1);
    }
  }

  printSummary(log, { plugin, server, port: args.pluginsOnly ? port : null });
  return exitCode;
}

// Run only when invoked as a script — importing (tests) stays side-effect free.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[shipwright] fatal: ${String(e?.stack ?? e)}`);
    process.exit(1);
  });
}
