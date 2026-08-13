import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// bootstrapper/test -> bootstrapper -> repo root
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CONFIG = path.join(REPO, "shipwright_changelog_config.json");

/**
 * Guards `shipwright_changelog_config.json` — the project-config file that
 * declares which package manifests `/shipwright-changelog` must keep in
 * lock-step with the release version (via the changelog plugin's
 * manifest-version-sync). WebUI ships no code that reads this file (the
 * changelog plugin is the consumer), so this test IS the webui-side contract:
 * the declaration must stay well-formed and point at manifests that exist.
 *
 * The field names/format value mirror the plugin's parser
 * (`load_declared_manifests` in `manifest_sync_core.py`): a `published_manifests`
 * array of `{ path, format }` objects with `format: "package_json"`.
 */
const EXPECTED_PATHS = [
  "bootstrapper/package.json",
  "server/package.json",
  "client/package.json",
];

// Read + parse lazily inside each test (never at collection time) so a deleted
// or malformed file surfaces as the "exists"/"valid JSON" test failing with a
// clean diagnostic, rather than an ENOENT crash during module collection that
// prevents every assertion — including "exists" — from ever running.
function loadRaw() {
  return readFileSync(CONFIG, "utf-8");
}
function loadConfig() {
  return JSON.parse(loadRaw());
}

describe("shipwright_changelog_config.json — published-manifest declaration", () => {
  it("exists at the repo root", () => {
    expect(existsSync(CONFIG)).toBe(true);
  });

  it("is valid JSON with no leading BOM", () => {
    const raw = loadRaw();
    expect(raw.charCodeAt(0)).not.toBe(0xfeff); // a BOM breaks strict JSON parsers
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("declares published_manifests as a non-empty array", () => {
    const parsed = loadConfig();
    expect(Array.isArray(parsed.published_manifests)).toBe(true);
    expect(parsed.published_manifests.length).toBeGreaterThan(0);
  });

  it("every entry is a { path, format: 'package_json' } object with a non-empty path", () => {
    for (const entry of loadConfig().published_manifests) {
      expect(typeof entry).toBe("object");
      expect(typeof entry.path).toBe("string");
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.format).toBe("package_json");
    }
  });

  it("has no duplicate declared paths", () => {
    // The consumer rejects duplicate manifest paths (`duplicate_manifest_path`);
    // pin that from the webui side so a copy-paste slip fails here first.
    const paths = loadConfig().published_manifests.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("declares exactly the three shipped manifests (bootstrapper, server, client)", () => {
    const declared = loadConfig().published_manifests.map((e) => e.path).sort();
    expect(declared).toEqual([...EXPECTED_PATHS].sort());
  });

  it("every declared manifest exists and is a package.json carrying a version string", () => {
    for (const entry of loadConfig().published_manifests) {
      const abs = path.join(REPO, entry.path);
      expect(existsSync(abs), `${entry.path} must exist`).toBe(true);
      const pkg = JSON.parse(readFileSync(abs, "utf-8"));
      expect(typeof pkg.version, `${entry.path} needs a version`).toBe("string");
    }
  });

  it("includes both manifests the version-parity guard couples (bootstrapper + server)", () => {
    const declared = new Set(loadConfig().published_manifests.map((e) => e.path));
    // guards.test.mjs asserts bootstrapper.version === server.version; a release
    // that bumped only one of them would break that guard, so both must be
    // declared here to move together.
    expect(declared.has("bootstrapper/package.json")).toBe(true);
    expect(declared.has("server/package.json")).toBe(true);
  });
});
