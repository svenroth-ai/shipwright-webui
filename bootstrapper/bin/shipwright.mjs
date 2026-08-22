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

import { readFileSync, realpathSync } from "node:fs";
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

/**
 * Decide whether to boot the Command Center after the plugin phase.
 *
 * The cold-start failure this closes: when a hard prerequisite (Claude / uv /
 * Python) is missing, the plugin phase is correctly SKIPPED — but the bin then
 * booted the Command Center anyway, i.e. a WebUI that launches a Claude with NO
 * `/shipwright-*` commands. That is useless, so the default flow now STOPS.
 * `--webui-only` is the explicit opt-out (it never runs the plugin phase, so
 * `pluginSkipped` is false there and it still boots).
 *
 * @param {{ pluginsOnly: boolean, webuiOnly: boolean, pluginSkipped: boolean }} s
 * @returns {{ boot: boolean, reason: "plugins-only" | "prereqs-missing" | "ok" }}
 */
export function serverBootDecision({ pluginsOnly, webuiOnly, pluginSkipped }) {
  if (pluginsOnly) return { boot: false, reason: "plugins-only" };
  if (pluginSkipped && !webuiOnly) return { boot: false, reason: "prereqs-missing" };
  return { boot: true, reason: "ok" };
}

export async function main(argv = process.argv.slice(2), log = (m) => console.log(m), deps = {}) {
  // Seams (default to the real implementations) so main's control flow — the
  // prereqs-missing hard-stop especially — is unit-testable without a real
  // toolchain or a live :3847.
  const runPluginPhase = deps.pluginPhase ?? pluginPhase;
  const runEnsureServer = deps.ensureServer ?? ensureServer;

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
    plugin = await runPluginPhase(log);
    exitCode = Math.max(exitCode, plugin.exitCode ?? 0);
  }

  const bootDecision = serverBootDecision({
    pluginsOnly: args.pluginsOnly,
    webuiOnly: args.webuiOnly,
    pluginSkipped: plugin?.skipped === true,
  });

  if (bootDecision.reason === "prereqs-missing") {
    // Hard-stop: a Command Center with no plugins would launch a Claude with no
    // /shipwright-* commands. The per-tool install hints already printed above
    // (renderVerdict); here we say why we stopped and how to override.
    log(`\n${MARK.fail} Not starting the Command Center — required tools are missing.`);
    log(`      Shipwright needs Claude Code, Python 3.11+ with uv, and git installed first;`);
    log(`      without them the plugins cannot install and the Command Center would be empty.`);
    log(`      Install whichever tools are marked missing above, then re-run  npx @svenroth-ai/shipwright@latest`);
    log(`      (To start the Command Center anyway, without plugins: add --webui-only.)`);
    printSummary(log, { plugin, server: null, port: null });
    return Math.max(exitCode, 1);
  }

  if (bootDecision.boot) {
    try {
      server = await runEnsureServer({ port, pkgRoot: PKG_ROOT, packageVersion: SELF_VERSION, noOpen: args.noOpen, log });
    } catch (e) {
      log(`${MARK.fail} ${String(e?.message ?? e)}`);
      exitCode = Math.max(exitCode, 1);
    }
  }

  printSummary(log, { plugin, server, port: args.pluginsOnly ? port : null });
  return exitCode;
}

/**
 * True when this module is the process entry point — INCLUDING when it is
 * invoked through a symlink. npm/npx install the executable as a symlink in
 * `node_modules/.bin/`, so on macOS/Linux `process.argv[1]` is that symlink
 * while Node realpaths the entry for `import.meta.url` (the real file). A plain
 * `path.resolve` comparison of the two therefore never matches and `main()`
 * never runs — the bootstrapper exits 0 having done NOTHING (the silent-no-op
 * bug: `npx @svenroth-ai/shipwright` printed nothing on the Mac). Windows hid it
 * because its npm `.cmd` shim invokes node with the REAL path, not a symlink.
 *
 * Fix: realpath BOTH sides before comparing, so a symlink and its target compare
 * equal. The realpath is applied SYMMETRICALLY: if EITHER side cannot be
 * realpath'd (`realpathSync` throws — ENOENT from an odd launcher, or a
 * virtualized path such as Yarn PnP that has no on-disk realpath, or EACCES /
 * ELOOP), BOTH sides fall back to plain `path.resolve`. A mixed branch — one
 * side realpath'd, the other only resolved — would spuriously mismatch and
 * re-introduce the very silent-no-op this fixes; symmetry rules that out. An
 * entry-point guard must also never crash the bootstrapper on import, hence the
 * catch. The real npx entry always has an existing argv[1], so both sides
 * realpath and canonicalize identically.
 */
export function isMainModule(argv1, metaUrl) {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl);
  try {
    return realpathSync(argv1) === realpathSync(self);
  } catch {
    return path.resolve(argv1) === path.resolve(self);
  }
}

// Run only when invoked as a script — importing (tests) stays side-effect free.
if (isMainModule(process.argv[1], import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[shipwright] fatal: ${String(e?.stack ?? e)}`);
    process.exit(1);
  });
}
