#!/usr/bin/env node
/**
 * build-package.mjs — stage the npm tarball contents.
 *
 * The published `@svenroth-ai/shipwright` ships the BUILT server + client (so
 * re-running the command IS the update — no clone, no make, no git pull). This
 * script stages, into the package root, exactly what the `files` whitelist
 * ships: server/dist, client/dist, server/profiles, the detached-swap runtime
 * scripts, and LICENSE. It COMPILES nothing itself beyond delegating to each
 * workspace's own `build` when its dist is missing — there is deliberately no
 * `prepublishOnly`, so this can never trigger a publish.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const REPO = path.resolve(PKG, "..");
const isWin = process.platform === "win32";

function log(m) {
  console.log(`[build-package] ${m}`);
}

/** Delegate to a workspace's own `npm run build` when its dist is absent. */
function ensureBuilt(workspace, distRel) {
  const dist = path.join(REPO, workspace, distRel);
  if (existsSync(dist)) {
    log(`${workspace}/${distRel} present — reusing.`);
    return;
  }
  log(`${workspace}/${distRel} missing — running \`npm run build\` in ${workspace}/ ...`);
  const r = spawnSync(isWin ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: path.join(REPO, workspace),
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(`\`npm run build\` failed in ${workspace}/ (exit ${r.status}) — cannot stage the package`);
  }
}

/** Fresh copy src → dst (dst wiped first so a stale build never lingers). */
function stageDir(srcAbs, dstRel) {
  const dst = path.join(PKG, dstRel);
  if (!existsSync(srcAbs)) throw new Error(`expected source missing: ${srcAbs}`);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(srcAbs, dst, { recursive: true });
  log(`staged ${dstRel}`);
}

function stageFile(srcAbs, dstRel) {
  if (!existsSync(srcAbs)) {
    log(`WARNING: ${srcAbs} missing — skipping ${dstRel}`);
    return;
  }
  const dst = path.join(PKG, dstRel);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(srcAbs, dst);
  log(`staged ${dstRel}`);
}

function main() {
  ensureBuilt("server", "dist");
  ensureBuilt("client", "dist");

  stageDir(path.join(REPO, "server", "dist"), "server/dist");
  stageDir(path.join(REPO, "client", "dist"), "client/dist");
  stageDir(path.join(REPO, "server", "profiles"), "server/profiles");

  // The server reads its OWN version from `server/package.json` at runtime
  // (diagnostics `app.version` — the bootstrapper's attach-vs-swap signal).
  // Without this file the packaged server reports "unknown" and every update
  // silently no-ops. Ship it (external-review HIGH).
  stageFile(path.join(REPO, "server", "package.json"), "server/package.json");

  // The detached swap runtime (driven by lib/server.mjs). Shipped as-is; the
  // swapper — not the bootstrapper — owns the kill, and it runs detached.
  for (const f of ["deploy-swap.mjs", "deploy-procs.mjs", "repair-claude-json.mjs", "kill-targets.js"]) {
    stageFile(path.join(REPO, "scripts", f), path.join("scripts", f));
  }

  stageFile(path.join(REPO, "LICENSE"), "LICENSE");
  log("done — run `npm pack --dry-run` to inspect the tarball.");
}

main();
