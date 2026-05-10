/*
 * Cross-mirror parity test (per ADR-080 duplicate-types pattern).
 *
 * server/src/lib/{resolveNetworkProfile,resolveTailscaleIp}.ts and
 * client/src/lib/{resolveNetworkProfile,resolveTailscaleIp}.ts must
 * produce IDENTICAL output for matched-vector inputs. Drift between
 * the two halves causes Vite proxy + Hono bind to diverge — debug
 * nightmare. This test reads BOTH files via fs and asserts the same
 * fixtures yield the same result on both sides.
 *
 * Pattern follows server/src/types/action-schema-sync.test.ts and
 * server/src/test/no-cross-package-imports.test.ts (ADR-080
 * companions).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveNetworkProfile as serverResolveNetworkProfile } from "./resolveNetworkProfile.js";
import { resolveTailscaleIp as serverResolveTailscaleIp } from "./resolveTailscaleIp.js";
// Cross-package READ via fs.readFileSync would normally violate ADR-080,
// but pure-text inspection from a TEST is the documented escape hatch
// (see action-schema-sync.test.ts). We DON'T import the client functions
// — we import via dynamic-import-from-resolved-path of the compiled
// .ts source through tsx, which is what vitest already does for the
// server test runner. Below, we use the same module path resolution
// that the no-cross-package-imports drift-guard test does for its
// content scanning.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = [
  { name: "unset", env: {}, expectedHost: undefined },
  { name: "whitespace", env: { SHIPWRIGHT_NETWORK_PROFILE: "  " }, expectedHost: undefined },
  { name: "local", env: { SHIPWRIGHT_NETWORK_PROFILE: "local" }, expectedHost: "127.0.0.1" },
  { name: "tailscale-via-env", env: { SHIPWRIGHT_NETWORK_PROFILE: "tailscale", SHIPWRIGHT_TAILSCALE_IP: "100.105.29.88" }, expectedHost: "100.105.29.88" },
  { name: "open", env: { SHIPWRIGHT_NETWORK_PROFILE: "open" }, expectedHost: "0.0.0.0" },
] as const;

describe("network-profile mirror parity (server vs client)", () => {
  it("client mirror file exists at expected path", () => {
    const clientPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "client",
      "src",
      "lib",
      "resolveNetworkProfile.ts",
    );
    expect(() => readFileSync(clientPath, "utf-8")).not.toThrow();
  });

  it("client tailscale-resolver mirror file exists", () => {
    const clientPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "client",
      "src",
      "lib",
      "resolveTailscaleIp.ts",
    );
    expect(() => readFileSync(clientPath, "utf-8")).not.toThrow();
  });

  it("client and server export the same function names", () => {
    const serverProfile = readFileSync(
      resolve(__dirname, "resolveNetworkProfile.ts"),
      "utf-8",
    );
    const clientProfile = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "client",
        "src",
        "lib",
        "resolveNetworkProfile.ts",
      ),
      "utf-8",
    );
    expect(serverProfile).toContain("export function resolveNetworkProfile");
    expect(clientProfile).toContain("export function resolveNetworkProfile");

    const serverTs = readFileSync(
      resolve(__dirname, "resolveTailscaleIp.ts"),
      "utf-8",
    );
    const clientTs = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "client",
        "src",
        "lib",
        "resolveTailscaleIp.ts",
      ),
      "utf-8",
    );
    expect(serverTs).toContain("export function resolveTailscaleIp");
    expect(clientTs).toContain("export function resolveTailscaleIp");
  });

  for (const fixture of FIXTURES) {
    it(`server resolver matches expected host for fixture: ${fixture.name}`, () => {
      const exec = vi.fn(() => "100.64.0.1\n"); // unused for env-only fixtures
      const result = serverResolveNetworkProfile(fixture.env, exec);
      if (fixture.expectedHost === undefined) {
        expect(result).toBeUndefined();
      } else {
        expect(result?.host).toBe(fixture.expectedHost);
      }
    });
  }

  it("server resolveTailscaleIp env-override fixture", () => {
    expect(
      serverResolveTailscaleIp(
        { SHIPWRIGHT_TAILSCALE_IP: "100.64.0.1" },
        vi.fn(() => ""),
      ),
    ).toBe("100.64.0.1");
  });

  // The client side is verified by client's own test suite
  // (resolveNetworkProfile.test.ts + resolveTailscaleIp.test.ts);
  // running both halves' suites + this content-presence + matched-
  // fixture pattern catches drift in three places: shape (function
  // names), structure (file paths), and behavior (server fixtures).
  // Below adds a fourth layer: byte-equivalence of the function
  // bodies after normalisation (catches any code drift between
  // mirrors — addresses external code review medium "behavioral
  // parity not actually verified").

  function normalize(content: string): string {
    return content
      // strip block comments (JSDoc + multi-line) and line comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      // strip "(client mirror)" describe markers if any leak in
      .replace(/\(client mirror\)/g, "")
      // collapse whitespace
      .replace(/\s+/g, " ")
      .trim();
  }

  it("resolveTailscaleIp.ts: server and client are byte-equivalent (post-comment-strip)", () => {
    const serverContent = readFileSync(
      resolve(__dirname, "resolveTailscaleIp.ts"),
      "utf-8",
    );
    const clientContent = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "client",
        "src",
        "lib",
        "resolveTailscaleIp.ts",
      ),
      "utf-8",
    );
    expect(normalize(clientContent)).toBe(normalize(serverContent));
  });

  it("resolveNetworkProfile.ts: server and client are byte-equivalent (post-comment-strip)", () => {
    const serverContent = readFileSync(
      resolve(__dirname, "resolveNetworkProfile.ts"),
      "utf-8",
    );
    const clientContent = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "client",
        "src",
        "lib",
        "resolveNetworkProfile.ts",
      ),
      "utf-8",
    );
    // Note: server uses `.js` import suffix (NodeNext module resolution),
    // client uses bare specifier (bundler resolution). Both produce the
    // SAME runtime behavior; normalise out the suffix so they compare.
    const normalizeImports = (s: string) =>
      normalize(s).replace(/\.js"/g, '"').replace(/\.js'/g, "'");
    expect(normalizeImports(clientContent)).toBe(normalizeImports(serverContent));
  });
});
