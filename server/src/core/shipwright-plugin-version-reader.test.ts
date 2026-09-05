/*
 * shipwright-plugin-version-reader.test.ts
 * (iterate-2026-09-05-nav-collapse-and-version-badges). Native-fs-free —
 * readFile + homedir are injected.
 */

import { describe, expect, it } from "vitest";
import {
  readShipwrightPluginVersion,
  shipwrightMarketplaceManifestPath,
} from "./shipwright-plugin-version-reader.js";

const HOME = "/home/user";
const okDeps = (body: string) => ({
  homedir: () => HOME,
  readFile: async (p: string) => {
    expect(p).toBe(shipwrightMarketplaceManifestPath(HOME));
    return body;
  },
});

describe("readShipwrightPluginVersion", () => {
  it("returns the suite version from the marketplace manifest", async () => {
    expect(
      await readShipwrightPluginVersion(okDeps(JSON.stringify({ version: "0.33.1" }))),
    ).toBe("0.33.1");
  });

  it("trims surrounding whitespace", async () => {
    expect(
      await readShipwrightPluginVersion(okDeps(JSON.stringify({ version: "  0.34.0 " }))),
    ).toBe("0.34.0");
  });

  it("returns null when the version key is absent", async () => {
    expect(await readShipwrightPluginVersion(okDeps(JSON.stringify({ name: "shipwright" })))).toBeNull();
  });

  it("returns null when version is not a string", async () => {
    expect(await readShipwrightPluginVersion(okDeps(JSON.stringify({ version: 42 })))).toBeNull();
  });

  it("returns null for an empty version string", async () => {
    expect(await readShipwrightPluginVersion(okDeps(JSON.stringify({ version: "  " })))).toBeNull();
  });

  it("returns null on malformed JSON (never throws)", async () => {
    expect(await readShipwrightPluginVersion(okDeps("{ not json"))).toBeNull();
  });

  it("returns null when the marketplace manifest is missing — plugin not installed (ENOENT swallowed)", async () => {
    const enoent = {
      homedir: () => HOME,
      readFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    expect(await readShipwrightPluginVersion(enoent)).toBeNull();
  });

  it("builds the path under the injected home dir, through .claude/plugins/marketplaces/shipwright", () => {
    const p = shipwrightMarketplaceManifestPath("/x");
    expect(p).toContain(".claude");
    expect(p).toContain("plugins");
    expect(p).toContain("marketplaces");
    expect(p).toContain("shipwright");
    expect(p).toContain("marketplace.json");
  });
});
