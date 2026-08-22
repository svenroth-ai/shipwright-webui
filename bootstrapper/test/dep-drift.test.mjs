// Drift guard for the published package's runtime dependency set.
//
// `bootstrapper/package.json` is the dependency set of @svenroth-ai/shipwright,
// the package `npx @svenroth-ai/shipwright` installs. The tarball ships the
// BUILT server (`server/dist/`) but NOT `server/node_modules`, so at runtime the
// packaged server resolves every `import` by walking up to the published
// package's own `node_modules` — i.e. against THIS file's `dependencies`. Any
// runtime dependency `server/package.json` declares that is NOT declared here is
// therefore absent on a fresh install and the server dies on boot with
// `ERR_MODULE_NOT_FOUND`.
//
// That is exactly how the cold start broke: `cron-parser@^5.5.0` was added to
// `server/package.json` in #376 (the org-route beat-register feature imports it
// from `server/dist/external/org/cron.js`) but never mirrored here, so the
// published server crashed the instant it was booted on a machine without the
// repo. `hono-cve-floor.test.mjs` guards ONE dependency's floor; this guards the
// whole set both ways — the two lists are a hand-maintained mirror, and a mirror
// needs a mechanical check or it drifts silently (this is the second time it
// has: hono in #374, cron-parser in #376).
//
// Asserts on the declared manifest RANGES, never the resolved lockfile — the
// lockfile is downstream of the manifest and cannot re-add a missing declaration.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// bootstrapper/test/<this file> → .. = bootstrapper/ ; ../.. = repo root
const bootstrapperRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = resolve(bootstrapperRoot, "..");

const bootstrapperPkg = JSON.parse(
  readFileSync(resolve(bootstrapperRoot, "package.json"), "utf-8"),
);
const serverPkg = JSON.parse(
  readFileSync(resolve(repoRoot, "server", "package.json"), "utf-8"),
);

const bootDeps = bootstrapperPkg.dependencies ?? {};
const serverDeps = serverPkg.dependencies ?? {};

describe("published package declares every server runtime dependency", () => {
  it("every server/ dependency is present in bootstrapper/ (the shipped node_modules)", () => {
    const missing = Object.keys(serverDeps).filter((name) => !(name in bootDeps));
    expect(
      missing,
      `server/package.json declares runtime deps absent from bootstrapper/package.json — ` +
        `the packaged server would throw ERR_MODULE_NOT_FOUND for these on a fresh npx install: ` +
        `${missing.join(", ")}. Add them to bootstrapper/package.json.dependencies.`,
    ).toEqual([]);
  });

  it("the shared deps declare identical ranges in both manifests (verbatim mirror)", () => {
    const mismatched = Object.keys(serverDeps)
      .filter((name) => name in bootDeps && bootDeps[name] !== serverDeps[name])
      .map((name) => `${name}: server=${serverDeps[name]} bootstrapper=${bootDeps[name]}`);
    expect(
      mismatched,
      `range drift between server/ and bootstrapper/ for shared deps — the published ` +
        `package must resolve the SAME version the server was built and tested against: ` +
        `${mismatched.join("; ")}`,
    ).toEqual([]);
  });

  it("cron-parser specifically is declared (the #376 regression that broke cold start)", () => {
    expect(bootDeps["cron-parser"], "cron-parser missing from the published dependency set").toBeDefined();
  });

  it("the mirror stays TOTAL: server declares no optional/peer runtime deps this guard would miss", () => {
    // The subset check above reads only `dependencies` — the set npm installs
    // into the published package. If server/ ever moves a runtime dep under
    // optionalDependencies or peerDependencies, it would be installed (or
    // expected) at runtime yet slip past that check. Fail loud the moment that
    // happens so the mirror is revisited deliberately rather than drifting.
    expect(
      Object.keys(serverPkg.optionalDependencies ?? {}),
      "server/package.json gained optionalDependencies — extend dep-drift to mirror them",
    ).toEqual([]);
    expect(
      Object.keys(serverPkg.peerDependencies ?? {}),
      "server/package.json gained peerDependencies — extend dep-drift to mirror them",
    ).toEqual([]);
  });

  it("the shared `overrides` floor matches too (a pin the server relies on must ship identically)", () => {
    // `overrides.ws` is declared in both manifests today; a divergence would let
    // the published package resolve a transitive version the server never tested.
    const so = serverPkg.overrides ?? {};
    const bo = bootstrapperPkg.overrides ?? {};
    const drift = Object.keys(so)
      .filter((name) => so[name] !== bo[name])
      .map((name) => `${name}: server=${so[name]} bootstrapper=${bo[name] ?? "<absent>"}`);
    expect(drift, `overrides drift between server/ and bootstrapper/: ${drift.join("; ")}`).toEqual([]);
  });
});
