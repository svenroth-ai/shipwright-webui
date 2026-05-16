/*
 * Regression guard: the production `dist/` build MUST include the
 * runtime non-TS assets the server reads at runtime.
 *
 * `tsc` emits only `.js` / `.d.ts` — it does NOT copy JSON/config that
 * is read via `fs.readFileSync` (as opposed to `import`ed). The single
 * such asset today is `src/config/default-actions.json`, read by
 * `core/project-actions-loader.ts loadBundledDefault()` from
 * `<module-dir>/../config/default-actions.json` — i.e.
 * `dist/config/default-actions.json` in production.
 *
 * The bug this guards: `server`'s `npm run build` used to be bare
 * `tsc`, so `dist/config/` never existed and `node dist/index.js`
 * threw ENOENT on the first GET /api/external/projects/:id/actions
 * (HTTP 500; the New-button + task actions never rendered). The
 * `tsx watch` dev-server runs from `src/`, so it never surfaced.
 *
 * The fix wires `scripts/copy-assets.mjs` into the build script. This
 * test fails loud if either half regresses:
 *   1. the `build` script stops invoking the copy step, OR
 *   2. `copy-assets.mjs` stops landing the config in `dist/config/`.
 *
 * See decision-drop iterate-2026-05-16-fix-prod-build-assets.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/test/<this file> → ../../.. = server/
const serverRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const pkgPath = resolve(serverRoot, "package.json");
const copyAssetsScript = resolve(serverRoot, "scripts", "copy-assets.mjs");
const srcConfigFile = resolve(serverRoot, "src", "config", "default-actions.json");
const distConfigDir = resolve(serverRoot, "dist", "config");
const distConfigFile = resolve(distConfigDir, "default-actions.json");

describe("production dist/ build includes runtime non-TS assets", () => {
  let copyResult: SpawnSyncReturns<string>;

  beforeAll(() => {
    // Clear dist/config so the assertions below prove the copy step
    // (re)created it — not that a stale leftover from an earlier build
    // happens to be present. `force` makes this a no-op when absent.
    rmSync(distConfigDir, { recursive: true, force: true });
    // Run the real production copy artifact. cwd = serverRoot because
    // copy-assets.mjs resolves "src/config" / "dist/config" relative to
    // the process cwd (the same cwd `npm run build` uses).
    copyResult = spawnSync(process.execPath, [copyAssetsScript], {
      cwd: serverRoot,
      encoding: "utf-8",
    });
  });

  it("package.json build script runs the copy-assets step after tsc", () => {
    // Contract test on the build script. The original bug was a bare
    // `tsc` build; if a refactor drops the copy step, fail loud here
    // rather than in production with an ENOENT 500.
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const build: string = pkg.scripts?.build ?? "";
    expect(build).toMatch(/\btsc\b/);
    expect(build).toMatch(/copy-assets\.mjs/);
    // Copy must run AFTER tsc so assets land in a freshly-emitted dist/.
    expect(build.indexOf("tsc")).toBeLessThan(build.indexOf("copy-assets"));
  });

  it("copy-assets.mjs runs cleanly (exit 0)", () => {
    expect(copyResult.status, copyResult.stderr).toBe(0);
  });

  it("default-actions.json lands at the loader's runtime path dist/config/", () => {
    expect(existsSync(distConfigFile)).toBe(true);
  });

  it("the copied default-actions.json is faithful to src/config/", () => {
    // The loader JSON.parses this file; a faithful copy is the contract.
    const src = JSON.parse(readFileSync(srcConfigFile, "utf-8"));
    const dist = JSON.parse(readFileSync(distConfigFile, "utf-8"));
    expect(dist).toEqual(src);
  });
});
