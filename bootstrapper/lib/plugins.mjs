/**
 * plugins.mjs — manifest-derived plugin install/update (NEVER a hardcoded list).
 *
 * The list of plugins comes from the marketplace manifest, in strict
 * precedence: (1) the local marketplace cache that `claude plugin marketplace
 * add/update` materialises, (2) a fetch of the GitHub raw manifest, (3) the
 * `SHIPWRIGHT_MARKETPLACE_MANIFEST` path override (also the test seam). There is
 * no step 4: if none resolve we ABORT loudly rather than bake in a list.
 *
 * Why so emphatic: the monorepo README says "all 13 plugins" while
 * `.claude-plugin/marketplace.json` lists 14 — the hardcoded list already
 * drifted. A baked list is a bug waiting to happen; the manifest is the SSoT.
 *
 * This module is PURE over injected seams (resolve, run, snapshot). The default
 * OS-touching implementations live in `claude-cli.mjs`.
 */

export const MANIFEST_RAW_URL =
  "https://raw.githubusercontent.com/svenroth-ai/shipwright/main/.claude-plugin/marketplace.json";

/**
 * Parse + DEFENSIVELY validate a marketplace manifest. A cross-repo schema
 * change breaks every user at once, so an unrecognised shape is a hard error
 * that NAMES the source — never a silent empty/partial plugin list.
 * @param {string} text @param {string} source  URL or path, for the error text
 * @returns {string[]} plugin names, in manifest order
 */
export function parseManifest(text, source) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`marketplace manifest at ${source} is not valid JSON: ${String(e?.message ?? e)}`);
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.plugins)) {
    throw new Error(
      `marketplace manifest at ${source} has no plugins[] array — refusing to guess a plugin list`,
    );
  }
  const names = [];
  const seen = new Set();
  for (const p of data.plugins) {
    if (!p || typeof p.name !== "string" || p.name.trim() === "") {
      throw new Error(
        `marketplace manifest at ${source} has a plugin entry with no valid "name" — ` +
          `refusing a silently empty or partial list`,
      );
    }
    const name = p.name.trim();
    // A name becomes an argument to `claude plugin install <name>@shipwright`.
    // Reject anything that isn't a plain package identifier — whitespace,
    // control chars, or shell metacharacters must never reach that call.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`marketplace manifest at ${source} has an invalid plugin name ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) {
      throw new Error(`marketplace manifest at ${source} lists duplicate plugin name "${name}"`);
    }
    seen.add(name);
    names.push(name);
  }
  if (names.length === 0) {
    throw new Error(`marketplace manifest at ${source} lists zero plugins — refusing to proceed`);
  }
  return names;
}

/**
 * Resolve the plugin names through the precedence chain. Every source is an
 * injected seam returning `{ text, source } | null` (or throwing, for the
 * explicit override path).
 * @param {{
 *   readLocalManifest: () => { text: string, source: string } | null,
 *   fetchRemoteManifest: () => Promise<{ text: string, source: string } | null>,
 *   readOverrideManifest: () => { text: string, source: string } | null,
 * }} seams
 * @returns {Promise<{ names: string[], source: string }>}
 */
export async function resolveMarketplacePlugins(seams) {
  const local = seams.readLocalManifest();
  if (local) return { names: parseManifest(local.text, local.source), source: local.source };

  const remote = await seams.fetchRemoteManifest();
  if (remote) return { names: parseManifest(remote.text, remote.source), source: remote.source };

  const override = seams.readOverrideManifest();
  if (override) return { names: parseManifest(override.text, override.source), source: override.source };

  throw new Error(
    "could not resolve the marketplace plugin list from the local cache, GitHub, or " +
      "SHIPWRIGHT_MARKETPLACE_MANIFEST — refusing to fall back to a hardcoded list",
  );
}

/**
 * Build a `{ name: version }` map from a parsed installed_plugins.json. Keys are
 * `<name>@<marketplace>`; we key the result by the bare plugin name.
 * @param {unknown} installedJson
 * @returns {Record<string, string>}
 */
export function buildInstalledMap(installedJson) {
  /** @type {Record<string, string>} */
  const out = {};
  const plugins =
    installedJson && typeof installedJson === "object"
      ? /** @type {any} */ (installedJson).plugins
      : null;
  if (!plugins || typeof plugins !== "object") return out;
  for (const [key, entries] of Object.entries(plugins)) {
    const name = key.split("@")[0];
    const first = Array.isArray(entries) ? entries[0] : null;
    if (name && first && typeof first.version === "string") out[name] = first.version;
  }
  return out;
}

/**
 * Install (first run) or update (already installed) every resolved plugin,
 * sequentially, each exit code checked. One failure is reported and does not
 * stop the rest. `pluginsChanged` is derived from a name→version snapshot taken
 * before and after — it, and only it, drives the restart notice (AC5).
 *
 * @param {{
 *   runClaude: (args: string[]) => { ok: boolean, code: number | null, stdout: string, stderr: string },
 *   resolvePlugins: () => Promise<{ names: string[], source: string }>,
 *   snapshotInstalled: () => Record<string, string>,
 *   log?: (msg: string) => void,
 * }} deps
 */
export async function ensurePlugins(deps) {
  const log = deps.log ?? (() => {});

  // 1. Marketplace: add (first run) → on "already exists", update (rerun). Every
  //    exit code is checked: a failed add for ANY OTHER reason (network/auth) is
  //    recorded, not silently ignored (we still try the resolver fallbacks, but
  //    the caller must be able to see the marketplace step failed).
  const add = deps.runClaude(["plugin", "marketplace", "add", "svenroth-ai/shipwright"]);
  let marketplaceAction = "add";
  let marketplaceOk = add.ok;
  const alreadyExists = /already exist/i.test(`${add.stderr}${add.stdout}`);
  if (!add.ok && alreadyExists) {
    const upd = deps.runClaude(["plugin", "marketplace", "update", "shipwright"]);
    marketplaceAction = "update";
    marketplaceOk = upd.ok;
    if (!upd.ok) log(`  marketplace update FAILED (exit ${upd.code})`);
  } else if (!add.ok) {
    log(`  marketplace add FAILED (exit ${add.code}) — will try the manifest fallbacks`);
  }

  // 2. Snapshot BEFORE (from the same cache the resolver reads).
  const before = deps.snapshotInstalled();

  // 3. Resolve the list — the local cache exists now that `add` ran.
  const { names, source } = await deps.resolvePlugins();

  // 4. Install-or-update each, checking every exit code.
  /** @type {{name:string, action:string, ok:boolean, code:number|null}[]} */
  const results = [];
  for (const name of names) {
    const action = before[name] != null ? "update" : "install";
    const r = deps.runClaude(["plugin", action, `${name}@shipwright`]);
    results.push({ name, action, ok: r.ok, code: r.code });
    if (!r.ok) log(`  plugin ${action} FAILED: ${name}@shipwright (exit ${r.code})`);
  }

  // 5. Snapshot AFTER, derive the changed-set (order-independent — the maps come
  //    from installed_plugins.json, whose key order is not a signal).
  const after = deps.snapshotInstalled();
  const pluginsChanged = !mapsEqual(before, after);
  const failures = results.filter((r) => !r.ok);

  return { names, source, marketplaceAction, marketplaceOk, results, before, after, pluginsChanged, failures };
}

/** Order-independent equality of two `{ name: version }` maps. */
export function mapsEqual(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}
